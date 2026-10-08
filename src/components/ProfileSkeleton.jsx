const Skeleton = ({ className = '' }) => (
    <div className={`animate-pulse rounded-md bg-gray-200 dark:bg-gray-700 ${className}`} />
);

const ProfileSkeleton = () => (
    <div className="w-full min-h-screen bg-slate-200/50 dark:bg-slate-950/60">
        <div className="w-full min-h-screen max-w-[1180px] mx-auto flex flex-col p-4 text-[12px] md:text-[13px]">
            <div className="mb-4 space-y-2">
                <Skeleton className="h-9 w-44" />
                <Skeleton className="h-3 w-72 max-w-full" />
            </div>
            <div className="flex flex-1 flex-col gap-4 md:flex-row">
                <div className="flex w-full flex-col gap-3 md:w-1/3">
                    <div className="flex flex-col items-center rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                        <Skeleton className="h-28 w-28 rounded-full md:h-32 md:w-32" />
                        <Skeleton className="mt-4 h-3 w-28" />
                        <Skeleton className="mt-3 h-6 w-24 rounded-full" />
                    </div>
                    <div className="hidden rounded-2xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:block">
                        <Skeleton className="mb-3 h-3 w-28" />
                        <div className="space-y-2">
                            <Skeleton className="h-9 w-full rounded-xl" />
                            <Skeleton className="h-9 w-full rounded-xl" />
                        </div>
                    </div>
                </div>
                <div className="w-full md:w-2/3">
                    <div className="space-y-5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:p-5">
                        <div className="border-b border-gray-100 pb-4 dark:border-gray-700">
                            <Skeleton className="h-4 w-36" />
                        </div>
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                            {Array.from({ length: 6 }).map((_, index) => (
                                <div key={`profile-field-skeleton-${index}`} className="space-y-2">
                                    <Skeleton className="h-3 w-24" />
                                    <Skeleton className="h-10 w-full rounded-xl" />
                                    <Skeleton className="h-2.5 w-3/4" />
                                </div>
                            ))}
                        </div>
                        <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
                            <Skeleton className="mb-3 h-3 w-28" />
                            <Skeleton className="h-16 w-full rounded-xl" />
                        </div>
                        <div className="flex justify-end border-t border-gray-100 pt-4 dark:border-gray-700">
                            <Skeleton className="h-9 w-28 rounded-xl" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

export default ProfileSkeleton;
