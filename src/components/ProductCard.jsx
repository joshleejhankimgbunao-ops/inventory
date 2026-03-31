import React from 'react';

const ProductCard = ({ name, category, price, imageText = "IMG" }) => {
    return (
        <div className="border border-gray-200 rounded-lg p-3 flex items-center space-x-3 hover:shadow-md transition-shadow bg-white">
            <div className="h-12 w-12 bg-gray-100 rounded-md flex items-center justify-center text-gray-400 text-xs font-bold">
                {imageText}
            </div>
            <div>
                <h4 className="text-base font-bold text-gray-900 leading-tight">{name}</h4>
                <p className="text-xs text-gray-500">{category}</p>
                <p className="text-indigo-600 text-sm font-bold mt-0.5">{price}</p>
            </div>
        </div>
    );
};

export default ProductCard;
