export const getBatchVerificationException = (batch, overallVerified) => {
    if (typeof batch?.balanceConfirmed !== 'boolean' || batch.balanceConfirmed === overallVerified) return null;
    return batch.balanceConfirmed ? 'Verified' : 'Not Yet Verified';
};
