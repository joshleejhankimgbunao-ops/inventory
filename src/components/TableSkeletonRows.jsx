const widths = ['w-10', 'w-14', 'w-20', 'w-24', 'w-28'];

const TableSkeletonRows = ({ columnTypes = [], rows = 6, rowKeyPrefix = 'table-skeleton' }) => (
    Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={`${rowKeyPrefix}-${rowIndex}`} className="animate-pulse">
            {columnTypes.map((type, columnIndex) => (
                <td key={`${rowKeyPrefix}-${rowIndex}-${columnIndex}`} className="border border-gray-200 px-3 py-2 dark:border-gray-700">
                    {type === 'actions' ? (
                        <div className="mx-auto flex items-center justify-center gap-1.5">
                            <div className="h-6 w-6 rounded-md bg-gray-200 dark:bg-gray-700" />
                            <div className="h-6 w-6 rounded-md bg-gray-200 dark:bg-gray-700" />
                        </div>
                    ) : (
                        <div
                            className={type === 'pill'
                                ? 'mx-auto h-5 w-16 rounded-full bg-gray-200 dark:bg-gray-700'
                                : `mx-auto h-4 ${widths[(rowIndex + columnIndex) % widths.length]} rounded-md bg-gray-200 dark:bg-gray-700`
                            }
                        />
                    )}
                </td>
            ))}
        </tr>
    ))
);

export default TableSkeletonRows;
