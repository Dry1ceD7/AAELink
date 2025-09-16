import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'text' | 'transparent';
  className?: string;
}

const Logo: React.FC<LogoProps> = ({
  size = 'md',
  variant = 'default',
  className = ''
}) => {
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
    xl: 'h-16 w-16'
  };

  const textSizeClasses = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
    xl: 'text-3xl'
  };

  if (variant === 'text') {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className={`${sizeClasses[size]} bg-gradient-to-br from-blue-600 to-purple-700 rounded-full flex items-center justify-center`}>
          <span className="text-white font-bold text-sm">AAE</span>
        </div>
        <span className={`font-bold text-gray-900 dark:text-white ${textSizeClasses[size]}`}>
          AAELink
        </span>
      </div>
    );
  }

  if (variant === 'transparent') {
    return (
      <div className={`${sizeClasses[size]} bg-gradient-to-br from-blue-600 to-purple-700 rounded-full flex items-center justify-center ${className}`}>
        <span className="text-white font-bold text-sm">AAE</span>
      </div>
    );
  }

  // Default variant
  return (
    <div className={`${sizeClasses[size]} bg-gradient-to-br from-blue-600 to-purple-700 rounded-full flex items-center justify-center ${className}`}>
      <span className="text-white font-bold text-sm">AAE</span>
    </div>
  );
};

export default Logo;
