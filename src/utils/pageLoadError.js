const BACKEND_UNAVAILABLE_MESSAGE = 'Cannot reach API server. Please make sure the backend is running.';

const isNetworkFailure = (error) => (
  error?.isConnectionFailure === true
  || (error?.name === 'TypeError' && /fetch|network/i.test(error?.message || ''))
);

export const getPageLoadError = (error, { online } = {}) => {
  const browserOnline = typeof online === 'boolean'
    ? online
    : (typeof navigator === 'undefined' ? true : navigator.onLine);

  if (!browserOnline) {
    return {
      title: "You're Offline",
      message: 'This page requires an internet connection.',
    };
  }

  if (isNetworkFailure(error)) {
    return {
      title: 'Load Failed',
      message: BACKEND_UNAVAILABLE_MESSAGE,
    };
  }

  return {
    title: 'Load Failed',
    message: error?.message || BACKEND_UNAVAILABLE_MESSAGE,
  };
};

export const showPageLoadError = (showToast, error, toastId) => {
  const failure = getPageLoadError(error);
  showToast(failure.title, failure.message, 'error', toastId);
  return failure;
};
