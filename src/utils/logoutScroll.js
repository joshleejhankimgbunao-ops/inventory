export const resetLogoutScrollPositions = (
  documentRef = globalThis.document,
  windowRef = globalThis.window
) => {
  if (!documentRef || !windowRef) return;

  windowRef.scrollTo(0, 0);
  documentRef.documentElement.scrollTop = 0;
  documentRef.body.scrollTop = 0;

  // AnimatePresence keeps the outgoing Dashboard mounted for its exit. Reset
  // its own scroll regions and hide their bars only while that shell exits.
  documentRef.querySelectorAll('[data-dashboard-scroll-container]').forEach((container) => {
    container.scrollTop = 0;
    container.style.overflowY = 'hidden';
  });
};
