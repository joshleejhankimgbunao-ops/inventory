export const restartApp = (target = window) => {
  target.location.assign('/');
};

export const reloadPage = (target = window) => {
  target.location.reload();
};
