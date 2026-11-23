import React, { useState } from 'react';

const ProductPhotoUploadArea = ({
  disabled = false,
  inputProps = {},
  labelText = 'Add Product Photos',
  guidanceText = 'JPG, PNG, or WebP · Up to 3 photos, 5 MB each',
  accept = 'image/jpeg,image/png,image/webp',
  compact = false,
  surfaceClassName = 'bg-white',
  onFilesSelected,
}) => {
  const [dragging, setDragging] = useState(false);
  const uploadFiles = (files) => {
    const selectedFiles = Array.from(files || []);
    if (!disabled && selectedFiles.length) onFilesSelected(selectedFiles);
  };

  return (
    <label
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); uploadFiles(event.dataTransfer.files); }}
      className={`flex ${compact ? 'min-h-[56px]' : 'min-h-[68px]'} w-full max-w-sm cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-slate-700 focus-within:ring-offset-2 [@media(hover:hover)]:hover:border-slate-700 ${dragging ? 'border-slate-700 bg-slate-100' : `border-slate-300 ${surfaceClassName}`} ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5 shrink-0 text-slate-600">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="m20.5 15-4.2-4.2L7 19.5" />
      </svg>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{labelText}</span>
        <span className="mt-0.5 block text-xs leading-4 text-slate-500">{guidanceText}</span>
      </span>
      <input {...inputProps} type="file" className="sr-only" accept={accept} multiple disabled={disabled} onChange={(event) => { uploadFiles(event.target.files); event.target.value = ''; }} />
    </label>
  );
};

export default ProductPhotoUploadArea;
