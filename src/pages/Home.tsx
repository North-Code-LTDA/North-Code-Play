import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { LogOut, Home as HomeIcon, Tv, Film, PlaySquare, Settings, Menu, X, Search, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VideoPlayer } from '../components/VideoPlayer';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

import { HomeView } from '../views/HomeView';
import { LiveTvView } from '../views/LiveTvView';
import { MoviesView } from '../views/MoviesView';
import { SeriesView } from '../views/SeriesView';
import { ConfigView } from '../views/ConfigView';
import { FavoritesView } from '../views/FavoritesView';
import { XtreamProvider } from '../context/XtreamContext';
import { useDebounce } from '../hooks/useDebounce';

function NavItem({ icon: Icon, label, active, onClick }: { icon: any; label: string; active: boolean; onClick: () => void }) {
  const { ref, focused } = useFocusable({
    onEnterPress: onClick
  });

  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all ${active ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'} ${focused ? 'ring-4 ring-white scale-105 z-10' : ''}`}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}

export type ViewType = 'inicio' | 'live' | 'movies' | 'series' | 'favorites' | 'config';

export function Home() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState<any>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewType>('inicio');
  const [activeVideo, setActiveVideo] = useState<{ url: string; title: string, startAt?: number, streamId?: string | number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  useEffect(() => {
    const saved = localStorage.getItem('northcode_tv_credentials');
    if (!saved) {
      navigate('/');
    } else {
      setCredentials(JSON.parse(saved));
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('northcode_tv_credentials');
    navigate('/');
  };

  if (!credentials) return null;

  const NavItems = () => (
    <>
      <NavItem icon={HomeIcon} label="Início" active={currentView === 'inicio'} onClick={() => { setCurrentView('inicio'); setIsMobileMenuOpen(false); setSearchQuery(''); }} />
      <NavItem icon={Tv} label="TV ao Vivo" active={currentView === 'live'} onClick={() => { setCurrentView('live'); setIsMobileMenuOpen(false); setSearchQuery(''); }} />
      <NavItem icon={Film} label="Filmes" active={currentView === 'movies'} onClick={() => { setCurrentView('movies'); setIsMobileMenuOpen(false); setSearchQuery(''); }} />
      <NavItem icon={PlaySquare} label="Séries" active={currentView === 'series'} onClick={() => { setCurrentView('series'); setIsMobileMenuOpen(false); setSearchQuery(''); }} />
      <NavItem icon={Heart} label="Meus Favoritos" active={currentView === 'favorites'} onClick={() => { setCurrentView('favorites'); setIsMobileMenuOpen(false); setSearchQuery(''); }} />
      <div className="h-4" />
      <NavItem icon={Settings} label="Configurações" active={currentView === 'config'} onClick={() => { setCurrentView('config'); setIsMobileMenuOpen(false); setSearchQuery(''); }} />
    </>
  );

  const { ref: searchRef, focused: searchFocused } = useFocusable();
  const { ref: logoutRef, focused: logoutFocused } = useFocusable({ onEnterPress: handleLogout });

  const renderView = () => {
    switch (currentView) {
      case 'inicio':
        return <HomeView onPlay={(url, title, startAt, streamId) => setActiveVideo({ url, title, startAt, streamId })} searchQuery={debouncedSearchQuery} />;
      case 'live':
        return <LiveTvView onPlay={(url, title, startAt, streamId) => setActiveVideo({ url, title, startAt, streamId })} searchQuery={debouncedSearchQuery} />;
      case 'movies':
        return <MoviesView onPlay={(url, title, startAt, streamId) => setActiveVideo({ url, title, startAt, streamId })} searchQuery={debouncedSearchQuery} />;
      case 'series':
        return <SeriesView onPlay={(url, title, startAt, streamId) => setActiveVideo({ url, title, startAt, streamId })} searchQuery={debouncedSearchQuery} />;
      case 'favorites':
        return <FavoritesView onPlay={(url, title, startAt, streamId) => setActiveVideo({ url, title, startAt, streamId })} searchQuery={debouncedSearchQuery} />;
      case 'config':
        return <ConfigView />;
      default:
        return <HomeView onPlay={(url, title, startAt, streamId) => setActiveVideo({ url, title, startAt, streamId })} searchQuery={debouncedSearchQuery} />;
    }
  };

  return (
    <XtreamProvider credentials={credentials}>
      <div className="h-[100dvh] bg-nc-bg flex flex-col md:flex-row w-full overflow-hidden">
        <AnimatePresence>
          {activeVideo && (
            <VideoPlayer 
              streamUrl={activeVideo.url} 
              title={activeVideo.title} 
              onBack={() => setActiveVideo(null)}
              startAt={activeVideo.startAt}
              streamId={activeVideo.streamId}
            />
          )}
        </AnimatePresence>

        {/* Sidebar - Desktop */}
        <aside className="hidden md:flex flex-col w-64 border-r border-nc-border/50 bg-black/50 backdrop-blur-xl z-50 h-[100dvh] sticky top-0 shrink-0">
          <div className="p-6">
            <Logo className="scale-90 origin-left" />
          </div>
          
          <div className="flex-1 px-4 py-2 space-y-2 overflow-y-auto custom-scrollbar">
            <NavItems />
          </div>

          <div className="p-4 border-t border-nc-border/50 mt-auto shrink-0">
            <div className="flex items-center gap-3 px-4 py-3 mb-2">
              <div className="w-9 h-9 rounded-full bg-nc-primary/20 flex items-center justify-center text-nc-primary font-bold shrink-0 overflow-hidden border border-nc-border">
                {credentials.avatar ? (
                  <img src={credentials.avatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  (credentials.playlistName || 'M').charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium text-white truncate">{credentials.playlistName || 'Minha Lista'}</p>
                <p className="text-xs text-gray-400 truncate">{credentials.username}</p>
              </div>
            </div>
            <button 
              ref={logoutRef as React.RefObject<HTMLButtonElement>}
              onClick={handleLogout}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-red-500 hover:bg-red-500/10 transition-colors ${logoutFocused ? 'ring-4 ring-white' : ''}`}
            >
              <LogOut className="w-5 h-5" />
              <span>Sair</span>
            </button>
          </div>
        </aside>

        {/* Mobile Header */}
        <header className="md:hidden sticky top-0 w-full h-16 border-b border-nc-border/50 bg-black/80 backdrop-blur-xl z-[45] flex items-center justify-between px-4 shrink-0">
          <Logo className="scale-75 origin-left" />
          <button 
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 text-white"
          >
            <Menu className="w-6 h-6" />
          </button>
        </header>

        {/* Mobile Sidebar Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMobileMenuOpen(false)}
                className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
              />
              <motion.aside 
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                className="md:hidden fixed inset-y-0 left-0 w-64 bg-nc-bg-card border-r border-nc-border/50 z-[70] flex flex-col"
              >
                <div className="p-4 flex items-center justify-between border-b border-nc-border/50">
                  <Logo className="scale-75 origin-left" />
                  <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-nc-text-secondary hover:text-white">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
                  <NavItems />
                </div>
                <div className="p-4 border-t border-nc-border/50">
                  <div className="flex items-center gap-3 px-4 py-3 mb-2">
                    <div className="w-9 h-9 rounded-full bg-nc-primary/20 flex items-center justify-center text-nc-primary font-bold shrink-0 overflow-hidden border border-nc-border">
                      {credentials.avatar ? (
                        <img src={credentials.avatar} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        (credentials.playlistName || 'M').charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="text-sm font-medium text-white truncate">{credentials.playlistName || 'Minha Lista'}</p>
                      <p className="text-xs text-gray-400 truncate">{credentials.username}</p>
                    </div>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-5 h-5" />
                    <span>Sair</span>
                  </button>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex flex-col relative w-full h-full">
          {/* Top Search Bar */}
          {currentView !== 'config' && (
            <div className="w-full shrink-0 p-4 md:px-8 border-b border-nc-border/30 bg-nc-bg/80 backdrop-blur-lg flex items-center justify-center z-[40]">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-nc-text-secondary" />
                <input 
                  ref={searchRef as React.RefObject<HTMLInputElement>}
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Pesquisar..." 
                  className={`w-full pl-10 pr-4 py-2.5 bg-nc-bg-input rounded-xl text-white outline-none transition-colors border ${searchFocused ? 'ring-4 ring-nc-primary border-transparent' : 'border-nc-border/50 focus:border-nc-primary'}`}
                />
              </div>
            </div>
          )}
          <main className="flex-1 flex overflow-hidden relative">
            {renderView()}
          </main>
        </div>
      </div>
    </XtreamProvider>
  );
}
