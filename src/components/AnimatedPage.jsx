import React from 'react';
import { motion } from 'framer-motion';

const animations = {
    initial: { opacity: 0, y: 15, scale: 0.99 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -15, scale: 0.99 }
};

const AnimatedPage = ({ children, allowPageScroll = false }) => {
    return (
        <motion.div
            variants={animations}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className={`w-full flex flex-col ${allowPageScroll ? 'h-full' : 'h-full overflow-hidden'}`}
        >
            {children}
        </motion.div>
    );
};

export default AnimatedPage;
