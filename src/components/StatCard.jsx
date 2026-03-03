import React from 'react';

const StatCard = ({ title, value, icon, color, onClick, titleClassName = '', valueClassName = '' }) => {
    // Monochrome minimalist approach
    
    return (
        <div 
            onClick={onClick}
            className={`relative overflow-hidden bg-white rounded-xl p-4 shadow-sm border-x border-b border-gray-100 hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1 group ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
        >
            <div className={`absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black`}></div>
            <div className="flex items-center justify-between">
                <div>
                    <h3 className={`text-gray-500 ${titleClassName || 'text-xs'} font-bold uppercase tracking-wider mb-1 group-hover:text-gray-900 transition-colors`}>{title}</h3>
                    <div className={`${valueClassName || 'text-2xl'} font-black text-gray-900 tracking-tight`}>{value}</div>
                </div>
                <div className="p-3 rounded-xl bg-gray-900 text-white shadow-sm group-hover:scale-110 transition-transform duration-300">
                    {icon}
                </div>
            </div>
        </div>
    );
};

export default StatCard;
