export const shouldConfirmExpiryTrackingDisable = ({ mode, wasAlreadyTracked, enabled, requestedEnabled }) => (
    mode === 'edit' && wasAlreadyTracked && enabled && !requestedEnabled
);
