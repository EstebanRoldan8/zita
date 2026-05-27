export function PanelCard({ children, className = '', hover = false }) {
  return (
    <div className={`
      bg-[#1e293b]
      border border-violet-500/15
      rounded-xl
      ${hover ? 'hover:border-violet-500/40 hover:bg-[#1e293b]/80 transition-all duration-200 cursor-pointer' : ''}
      ${className}
    `}>
      {children}
    </div>
  )
}
