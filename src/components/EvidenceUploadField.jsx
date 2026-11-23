import { useEffect, useRef, useState } from 'react';
import { validateEvidenceFiles } from '../utils/evidenceUpload';
import ProductPhotoUploadArea from './ProductPhotoUploadArea';

const EvidenceUploadField = ({
  id,
  label,
  files,
  onChange,
  minFiles = 0,
  maxFiles = 3,
  allowedTypes = ['image/jpeg', 'image/png'],
  maxBytes = 5 * 1024 * 1024,
  disabled = false,
  error = '',
  uploadPresentation = 'default',
  uploadLabel = 'Add Product Photos',
  validationKey,
  validationAliases,
}) => {
  const addInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const previewCloseRef = useRef(null);
  const previewTriggerRef = useRef(null);
  const [replaceIndex, setReplaceIndex] = useState(null);
  const [localError, setLocalError] = useState('');
  const [previewIndex, setPreviewIndex] = useState(null);
  const [urls, setUrls] = useState([]);

  useEffect(() => {
    const nextUrls = files.map((file) => URL.createObjectURL(file));
    setUrls(nextUrls);
    return () => nextUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  useEffect(() => {
    if (previewIndex === null) return undefined;
    previewCloseRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPreviewIndex(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previewTriggerRef.current?.focus();
    };
  }, [previewIndex]);

  const validate = (nextFiles) => validateEvidenceFiles(nextFiles, { maxFiles, maxBytes, allowedTypes });

  const addFiles = (selected) => {
    const next = [...files, ...Array.from(selected || [])];
    const message = validate(next);
    setLocalError(message);
    if (!message) onChange(next);
    if (addInputRef.current) addInputRef.current.value = '';
  };

  const replaceFile = (selected) => {
    const file = selected?.[0];
    if (!file || replaceIndex === null) return;
    const next = files.map((item, index) => index === replaceIndex ? file : item);
    const message = validate(next);
    setLocalError(message);
    if (!message) onChange(next);
    setReplaceIndex(null);
    if (replaceInputRef.current) replaceInputRef.current.value = '';
  };

  const currentPreview = previewIndex === null ? null : files[previewIndex];
  const currentUrl = previewIndex === null ? '' : urls[previewIndex];
  const paymentProofGuidance = `${allowedTypes.includes('application/pdf') ? 'JPG, PNG, or PDF' : 'JPG or PNG'} · ${Math.round(maxBytes / 1024 / 1024)} MB per photo${minFiles ? ` · At least ${minFiles} required` : ''}`;
  const fieldError = localError || error;
  const errorId = `${id}-validation-error`;
  const fileInputValidationProps = {
    name: validationKey,
    'data-validation-key': validationKey,
    'data-validation-aliases': validationAliases,
    'aria-invalid': Boolean(fieldError) || undefined,
    'aria-describedby': fieldError ? errorId : undefined,
  };
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      {uploadPresentation === 'dashed' ? <span className="text-xs font-semibold text-slate-700">{label}{minFiles > 0 ? ' *' : ' (Optional)'}</span> : <label htmlFor={`${id}-add`} className="text-xs font-semibold text-slate-700">{label}{minFiles > 0 ? ' *' : ' (Optional)'}</label>}
      <span className="text-[11px] text-slate-500">{files.length} of {maxFiles}</span>
    </div>
    {uploadPresentation !== 'dashed' && <p className="text-[11px] text-slate-500">{paymentProofGuidance.replace(' per photo', ' per file')}</p>}
    {uploadPresentation !== 'dashed' && <input {...fileInputValidationProps} ref={addInputRef} id={`${id}-add`} type="file" className="sr-only" multiple accept={allowedTypes.join(',')} disabled={disabled || files.length >= maxFiles} onChange={(event) => addFiles(event.target.files)} />}
    <input ref={replaceInputRef} type="file" className="sr-only" accept={allowedTypes.join(',')} disabled={disabled} onChange={(event) => replaceFile(event.target.files)} />
    <div className="flex flex-wrap gap-1.5">
      {files.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className={`relative flex max-w-full items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 p-1.5 ${uploadPresentation === 'dashed' ? 'pr-7' : ''}`}>
        {file.type.startsWith('image/') && urls[index] ? <img src={urls[index]} alt="" className={`${uploadPresentation === 'dashed' ? 'h-11 w-11' : 'h-9 w-9'} rounded object-contain`} /> : <span className="flex h-9 w-9 items-center justify-center rounded bg-white text-[10px] text-slate-600">PDF</span>}
        <span className="max-w-24 truncate text-[11px] text-slate-700" title={file.name}>{file.name}</span>
        <button type="button" onClick={(event) => { previewTriggerRef.current = event.currentTarget; setPreviewIndex(index); }} disabled={disabled} className="rounded px-1 text-[11px] text-slate-700 underline focus-visible:ring-2 focus-visible:ring-slate-700">View</button>
        <button type="button" onClick={() => { setReplaceIndex(index); replaceInputRef.current?.click(); }} disabled={disabled} className="rounded px-1 text-[11px] text-slate-700 underline focus-visible:ring-2 focus-visible:ring-slate-700">Replace</button>
        {uploadPresentation === 'dashed' ? <button type="button" onClick={() => { onChange(files.filter((_, at) => at !== index)); setLocalError(''); }} disabled={disabled} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 shadow-sm hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Remove ${file.name}`} title="Remove photo"><svg aria-hidden="true" focusable="false" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3 w-3"><path d="m5 5 10 10M15 5 5 15" /></svg></button> : <button type="button" onClick={() => { onChange(files.filter((_, at) => at !== index)); setLocalError(''); }} disabled={disabled} className="rounded px-1 text-[11px] text-rose-700 underline focus-visible:ring-2 focus-visible:ring-rose-700">Remove</button>}
      </div>)}
      {files.length < maxFiles && (uploadPresentation === 'dashed' ? <ProductPhotoUploadArea disabled={disabled} inputProps={{ ...fileInputValidationProps, ref: addInputRef, id: `${id}-add` }} labelText={uploadLabel} guidanceText={paymentProofGuidance} accept={allowedTypes.join(',')} compact surfaceClassName="bg-slate-50" onFilesSelected={addFiles} /> : <button type="button" data-validation-key={validationKey} data-validation-aliases={validationAliases} aria-invalid={fieldError ? 'true' : undefined} aria-describedby={fieldError ? errorId : undefined} onClick={() => addInputRef.current?.click()} disabled={disabled} className="rounded-lg border border-dashed border-slate-400 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 disabled:opacity-50">Add {allowedTypes.includes('application/pdf') ? 'File' : 'Photo'}</button>)}
    </div>
    {fieldError && <p id={errorId} role="alert" className="text-xs text-rose-700">{fieldError}</p>}
    {currentPreview && currentUrl && <div className="app-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label={`${label} preview`}>
      <div className="max-h-full max-w-4xl">
        {currentPreview.type === 'application/pdf' ? <iframe title={currentPreview.name} src={currentUrl} className="h-[80vh] w-[80vw] max-w-4xl rounded bg-white" /> : <img src={currentUrl} alt={currentPreview.name} className="max-h-[80vh] max-w-full rounded bg-white object-contain" />}
        <button ref={previewCloseRef} type="button" onClick={() => setPreviewIndex(null)} className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-900 focus-visible:ring-2 focus-visible:ring-white">Close</button>
      </div>
    </div>}
  </div>;
};

export default EvidenceUploadField;
