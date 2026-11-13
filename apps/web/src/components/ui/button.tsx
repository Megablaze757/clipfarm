import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline'
}

export const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', className = '', ...props }) => {
  const base = 'px-4 py-2 rounded-lg font-medium transition-colors text-sm focus:outline-none'
  const variants = {
    primary: 'bg-sky-500 hover:bg-sky-600 text-white',
    secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-100',
    outline: 'border border-slate-700 hover:bg-slate-800 text-slate-200'
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}
