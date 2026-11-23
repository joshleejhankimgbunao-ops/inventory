import React from 'react';

const RecordActionIcon = ({ name, className = 'h-3.5 w-3.5 shrink-0' }) => {
  const icon = {
    eye: <><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></>,
    'file-plus': <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v4a2 2 0 0 0 2 2h4M12 13v6M9 16h6" /></>,
    'file-text': <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v4a2 2 0 0 0 2 2h4M8 13h8M8 17h8M8 9h2" /></>,
    'file-search': <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h6" /><path d="M14 2v4a2 2 0 0 0 2 2h4M8 12h5" /><circle cx="17" cy="17" r="3" /><path d="m19.2 19.2 2 2" /></>,
    'receipt-text': <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8M10 12h4" /></>,
    'archive-restore': <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8M10 12h4M12 16v-4m0 0-2 2m2-2 2 2" /></>,
    'calendar-clock': <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 9h18" /><circle cx="12" cy="15" r="3" /><path d="M12 13.5v1.8l1.2.7" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 8h18M16 14h2" /><path d="M3 5V4a2 2 0 0 1 2-2h13" /></>,
    'package-plus': <><path d="m12 22 8-4.5v-11L12 2 4 6.5v11L12 22Z" /><path d="m4.5 6.5 7.5 4 7.5-4M12 11v11M17 11v-5m-2.5 2.5h5" /></>,
    'package-minus': <><path d="m12 22 8-4.5v-11L12 2 4 6.5v11L12 22Z" /><path d="m4.5 6.5 7.5 4 7.5-4M12 11v11M15 8.5h5" /></>,
    'clipboard-check': <><rect x="5" y="4" width="14" height="18" rx="2" /><path d="M9 4.5V3h6v1.5M8 13l2.5 2.5L16 10" /></>,
    'clipboard-list': <><rect x="5" y="4" width="14" height="18" rx="2" /><path d="M9 4.5V3h6v1.5M11 11h4M11 15h4M11 19h4" /><path d="M8 11h.01M8 15h.01M8 19h.01" /></>,
    'circle-check': <><circle cx="12" cy="12" r="10" /><path d="m8 12 2.5 2.5L16 9" /></>,
  }[name];

  if (!icon) return null;

  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {icon}
    </svg>
  );
};

export default RecordActionIcon;
