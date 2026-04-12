import React from 'react';

const Shimmer = ({ className = '', style }) => (
    <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`} style={style}></div>
);

const PageSkeleton = () => (
    <div className="w-full h-full p-4 sm:p-5 animate-in fade-in">
        <div className="max-w-7xl mx-auto flex flex-col gap-4 sm:gap-5">
            <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-2">
                    <Shimmer className="h-6 w-44 sm:w-56" />
                    <Shimmer className="h-3 w-28 sm:w-36" />
                </div>
                <Shimmer className="h-9 w-28 rounded-full" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                {[...Array(3)].map((_, cardIndex) => (
                    <div key={cardIndex} className="rounded-xl border border-gray-100 bg-white p-4 sm:p-5 flex flex-col gap-3">
                        <Shimmer className="h-4 w-32" />
                        <Shimmer className="h-9 w-24" />
                        <Shimmer className="h-3 w-full" />
                    </div>
                ))}
            </div>

            <div className="rounded-xl border border-gray-100 bg-white p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                    <Shimmer className="h-4 w-36" />
                    <Shimmer className="h-4 w-20" />
                </div>
                <div className="space-y-3">
                    {[...Array(6)].map((_, rowIndex) => (
                        <div key={rowIndex} className="grid grid-cols-12 gap-3 items-center">
                            <Shimmer className="col-span-5 h-3" />
                            <Shimmer className="col-span-3 h-3" />
                            <Shimmer className="col-span-2 h-3" />
                            <Shimmer className="col-span-2 h-8 rounded-md" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    </div>
);

export default PageSkeleton;
