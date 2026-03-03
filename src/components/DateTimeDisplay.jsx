import React, { useState, useEffect } from 'react';

const DateTimeDisplay = ({ className = "text-right hidden md:block", dateClassName="text-gray-700", timeClassName="text-gray-500", oneLine = false }) => {
  const [currentDateTime, setCurrentDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (oneLine) {
    return (
      <div className={className}>
         <p className={`text-xs font-bold tracking-wide ${dateClassName}`}>
            {currentDateTime.toLocaleDateString(undefined, { weekday: 'long' })} | {currentDateTime.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} <span className={`ml-2 ${timeClassName}`}>{currentDateTime.toLocaleTimeString()}</span>
         </p>
      </div>
    )
  }

  return (
    <div className={className}>
      <p className={`text-xs font-bold ${dateClassName}`}>
        {currentDateTime.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </p>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${timeClassName}`}>
        {currentDateTime.toLocaleTimeString()}
      </p>
    </div>
  );
};

export default DateTimeDisplay;
