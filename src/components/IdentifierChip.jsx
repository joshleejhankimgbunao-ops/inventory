import React from 'react';

const IdentifierChip = ({ children, className = '' }) => (
    <span className={`inline-flex max-w-full break-all rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs font-semibold text-gray-600 ${className}`.trim()}>
        {children}
    </span>
);

export default IdentifierChip;
