const {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');

const REQUIRED_R2_ENVIRONMENT_VARIABLES = Object.freeze([
  'R2_ENDPOINT',
  'R2_BUCKET_NAME',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
]);

class R2StorageError extends Error {
  constructor(message, { cause = null, code = 'R2_STORAGE_ERROR', status = 503 } = {}) {
    super(message);
    this.name = 'R2StorageError';
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

const normalizeBucketName = (value) => String(value || '').trim().replace(/^\/+|\/+$/g, '');

const normalizeEndpoint = (value, bucketName) => {
  const endpoint = String(value || '').trim();
  if (!endpoint || !bucketName) return endpoint;

  try {
    const parsed = new URL(endpoint);
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    if (pathSegments.length === 1 && decodeURIComponent(pathSegments[0]) === bucketName) {
      parsed.pathname = '/';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return endpoint;
  }
};

const normalizeKey = (key, bucketName = '') => {
  let normalized = String(key || '').replace(/^\/+/, '');
  const bucketPrefix = bucketName ? `${bucketName}/` : '';

  while (bucketPrefix && normalized.startsWith(bucketPrefix)) {
    normalized = normalized.slice(bucketPrefix.length);
  }

  return normalized;
};

const isObjectNotFoundError = (error) => {
  const cause = error?.cause || error;
  const code = String(cause?.name || cause?.Code || cause?.code || '');
  const status = Number(cause?.$metadata?.httpStatusCode || cause?.statusCode || error?.status || 0);
  return status === 404 || ['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(code);
};

const getR2Configuration = (environment = process.env) => {
  const bucketName = normalizeBucketName(environment.R2_BUCKET_NAME);
  const config = {
    endpoint: normalizeEndpoint(environment.R2_ENDPOINT, bucketName),
    bucketName,
    accessKeyId: String(environment.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(environment.R2_SECRET_ACCESS_KEY || '').trim(),
  };

  const missing = REQUIRED_R2_ENVIRONMENT_VARIABLES.filter((name) => {
    const property = {
      R2_ENDPOINT: 'endpoint',
      R2_BUCKET_NAME: 'bucketName',
      R2_ACCESS_KEY_ID: 'accessKeyId',
      R2_SECRET_ACCESS_KEY: 'secretAccessKey',
    }[name];
    return !config[property];
  });

  return { ...config, missing, configured: missing.length === 0 };
};

const createR2StorageService = ({ environment = process.env, client = null } = {}) => {
  const config = getR2Configuration(environment);
  const storageClient = client || (config.configured
    ? new S3Client({
      endpoint: config.endpoint,
      region: 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
    : null);

  const assertConfigured = () => {
    if (!config.configured || !storageClient) {
      throw new R2StorageError(
        `Cloud storage is not configured. Set ${REQUIRED_R2_ENVIRONMENT_VARIABLES.join(', ')}.`,
        { code: 'R2_NOT_CONFIGURED' }
      );
    }
  };

  const send = async (command) => {
    assertConfigured();
    try {
      return await storageClient.send(command);
    } catch (error) {
      if (error instanceof R2StorageError) throw error;
      throw new R2StorageError('Cloud storage request failed.', { cause: error });
    }
  };

  const listObjects = async (prefix) => {
    const objects = [];
    let continuationToken;

    do {
      const result = await send(new ListObjectsV2Command({
        Bucket: config.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      objects.push(...(result.Contents || []).map((item) => ({
        key: item.Key,
        lastModified: item.LastModified || null,
        size: Number(item.Size || 0),
        etag: item.ETag || '',
      })));
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    return objects;
  };

  return {
    isConfigured: () => config.configured,
    getConfiguration: () => ({
      ...config,
      accessKeyId: config.accessKeyId ? '[configured]' : '',
      secretAccessKey: config.secretAccessKey ? '[configured]' : '',
    }),
    putObject: async ({ key, body, contentType = 'application/octet-stream', metadata = {} } = {}) => {
      const normalizedKey = normalizeKey(key, config.bucketName);
      if (!normalizedKey) {
        throw new R2StorageError('Cloud storage object key is required.', { code: 'R2_INVALID_KEY', status: 400 });
      }
      const result = await send(new PutObjectCommand({
        Bucket: config.bucketName,
        Key: normalizedKey,
        Body: body,
        ContentType: contentType,
        Metadata: metadata,
      }));
      return { key: normalizedKey, etag: result.ETag || '', versionId: result.VersionId || '' };
    },
    getObject: async (key) => {
      const normalizedKey = normalizeKey(key, config.bucketName);
      if (!normalizedKey) {
        throw new R2StorageError('Cloud storage object key is required.', { code: 'R2_INVALID_KEY', status: 400 });
      }
      try {
        return await send(new GetObjectCommand({ Bucket: config.bucketName, Key: normalizedKey }));
      } catch (error) {
        if (!isObjectNotFoundError(error)) throw error;
        return send(new GetObjectCommand({
          Bucket: config.bucketName,
          Key: `${config.bucketName}/${normalizedKey}`,
        }));
      }
    },
    deleteObject: async (key) => {
      const normalizedKey = normalizeKey(key, config.bucketName);
      if (!normalizedKey) return false;
      await send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: normalizedKey }));
      return true;
    },
    listObjectsByPrefix: async (prefix) => {
      const normalizedPrefix = normalizeKey(prefix, config.bucketName);
      const objects = await listObjects(normalizedPrefix);
      if (objects.length > 0 || !normalizedPrefix) return objects;

      const legacyBucketPrefix = `${config.bucketName}/`;
      const legacyObjects = await listObjects(`${legacyBucketPrefix}${normalizedPrefix}`);
      return legacyObjects.map((object) => ({
        ...object,
        key: String(object.key || '').startsWith(legacyBucketPrefix)
          ? String(object.key).slice(legacyBucketPrefix.length)
          : object.key,
      }));
    },
  };
};

const r2Storage = createR2StorageService();

module.exports = {
  REQUIRED_R2_ENVIRONMENT_VARIABLES,
  R2StorageError,
  createR2StorageService,
  getR2Configuration,
  isObjectNotFoundError,
  r2Storage,
};
