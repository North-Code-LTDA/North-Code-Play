const logo = new URL('../assets/logo.png', import.meta.url).href;

export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img 
        src={logo} 
        alt="North Code Play" 
        className="w-8 h-8 md:w-10 md:h-10 object-contain" 
      />
      <span className="font-semibold text-xl md:text-2xl tracking-tight text-white whitespace-nowrap">
        North Code Play
      </span>
    </div>
  );
}
