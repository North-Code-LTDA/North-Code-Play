import { Zap } from 'lucide-react';

export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative flex items-center justify-center w-10 h-10 rounded-full border-[2.5px] border-white">
        <Zap className="w-6 h-6 text-white fill-white absolute" />
      </div>
      <span className="font-semibold text-2xl tracking-tight text-white">NorthCode</span>
    </div>
  );
}
