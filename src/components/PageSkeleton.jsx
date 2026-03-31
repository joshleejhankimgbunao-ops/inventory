import React from 'react';

const Shimmer = ({ className = '' }) => (
    <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`}></div>
);

const PageSkeleton = () => (
    <div className="p-4 w-full h-full flex flex-col gap-4 animate-in fade-in">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <Shimmer className="w-8 h-8 rounded-lg" />
                <div className="flex flex-col gap-1.5">
                    <Shimmer className="w-32 h-3" />
                    <Shimmer className="w-20 h-2.5" />
                </div>
            </div>
            <Shimmer className="w-9 h-9 rounded-lg" />
        </div>

        {/* Stats row skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                        <Shimmer className="w-20 h-2.5" />
                        <Shimmer className="w-8 h-8 rounded-lg" />
                    </div>
                    <Shimmer className="w-24 h-5 mt-1" />
                </div>
            ))}
        </div>

        {/* Chart + sidebar skeleton */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-10 gap-3 min-h-0">
            {/* Main chart area */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-gray-100 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Shimmer className="w-7 h-7 rounded-lg" />
                        <Shimmer className="w-28 h-3.5" />
                    </div>
                    <Shimmer className="w-24 h-6 rounded" />
                </div>
                {/* Chart lines skeleton */}
                <div className="flex-1 flex items-end gap-1 px-2 pt-4 min-h-[200px]">
                    {[40, 65, 45, 80, 55, 70, 90, 60, 75, 50, 85, 68].map((h, i) => (
                        <div key={i} className="flex-1 flex flex-col justify-end">
                            <Shimmer className="w-full rounded-t" style={{ height: `${h}%` }} />
                        </div>
                    ))}
                </div>
                <div className="flex justify-center gap-6 pt-1">
                    <Shimmer className="w-16 h-2.5" />
                    <Shimmer className="w-16 h-2.5" />
                </div>
            </div>

            {/* Right sidebar panels */}
            <div className="lg:col-span-3 flex flex-col gap-3">
                <div className="bg-white rounded-xl border border-gray-100 p-4 flex-1 flex flex-col gap-2.5">
                    <div className="flex items-center gap-2 mb-1">
                        <Shimmer className="w-6 h-6 rounded-lg" />
                        <Shimmer className="w-28 h-3" />
                    </div>
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between py-1.5">
                            <div className="flex items-center gap-2">
                                <Shimmer className="w-5 h-5 rounded-full" />
                                <Shimmer className="w-20 h-2.5" />
                            </div>
                            <Shimmer className="w-8 h-2.5" />
                        </div>
                    ))}
                </div>
                <div className="bg-white rounded-xl border border-gray-100 p-4 flex-1 flex flex-col gap-2">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                            <Shimmer className="w-5 h-5 rounded" />
                            <Shimmer className="w-20 h-3" />
                        </div>
                        <Shimmer className="w-14 h-4 rounded-full" />
                    </div>
                    {[...Array(3)].map((_, i) => (
                        <Shimmer key={i} className="w-full h-10 rounded-lg" />
                    ))}
                </div>
            </div>
        </div>
    </div>
);

export default PageSkeleton;
