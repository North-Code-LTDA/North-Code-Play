import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { LogOut, Home as HomeIcon, Tv, Film, PlaySquare, Settings, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VideoPlayer } from '../components/VideoPlayer';

import { HomeView } from '../views/HomeView';
import { LiveTvView } from '../views/LiveTvView';
import { MoviesView } from '../views/MoviesView';
import { SeriesView } from '../views/SeriesView';
import { ConfigView } from '../views/ConfigView';
import { XtreamProvider } from '../context/XtreamContext';

export type ViewType = 'inicio' | 'live' | 'movies' | 'series' | 'config';

export function Home() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState<any>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewType>('inicio');
  const [activeVideo, setActiveVideo] = useState<{ url: string; title: string } | null>(null);

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
      <button onClick={() => { setCurrentView('inicio'); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'inicio' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}>
        <HomeIcon className="w-5 h-5" />
        <span>Início</span>
      </button>
      <button onClick={() => { setCurrentView('live'); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'live' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}>
        <Tv className="w-5 h-5" />
        <span>TV ao Vivo</span>
      </button>
      <button onClick={() => { setCurrentView('movies'); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'movies' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}>
        <Film className="w-5 h-5" />
        <span>Filmes</span>
      </button>
      <button onClick={() => { setCurrentView('series'); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'series' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}>
        <PlaySquare className="w-5 h-5" />
        <span>Séries</span>
      </button>
      <button onClick={() => { setCurrentView('config'); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'config' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}>
        <Settings className="w-5 h-5" />
        <span>Configurações</span>
      </button>
    </>
  );

  const renderView = () => {
    switch (currentView) {
      case 'inicio':
        return <HomeView onPlay={(url, title) => setActiveVideo({ url, title })} />;
      case 'live':
        return <LiveTvView onPlay={(url, title) => setActiveVideo({ url, title })} />;
      case 'movies':
        return <MoviesView onPlay={(url, title) => setActiveVideo({ url, title })} />;
      case 'series':
        return <SeriesView onPlay={(url, title) => setActiveVideo({ url, title })} />;
      case 'config':
        return <ConfigView />;
      default:
        return <HomeView onPlay={(url, title) => setActiveVideo({ url, title })} />;
    }
  };

  return (
    <XtreamProvider credentials={credentials}>
      <div className="min-h-screen bg-nc-bg flex overflow-hidden">
        <AnimatePresence>
          {activeVideo && (
            <VideoPlayer 
              streamUrl={activeVideo.url} 
              title={activeVideo.title} 
              onBack={() => setActiveVideo(null)} 
            />
          )}
        </AnimatePresence>

        {/* Sidebar - Desktop */}
        <aside className="hidden md:flex flex-col w-64 border-r border-nc-border/50 bg-black/50 backdrop-blur-xl z-50 h-screen sticky top-0 shrink-0">
          <div className="p-6">
            <Logo className="scale-90 origin-left" />
          </div>
          
          <div className="flex-1 px-4 py-2 space-y-2">
            <NavItems />
          </div>

          <div className="p-4 border-t border-nc-border/50">
            <div className="flex items-center gap-3 px-4 py-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-nc-primary/20 flex items-center justify-center text-nc-primary font-bold">
                {credentials.username.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium text-white truncate">{credentials.username}</p>
                <p className="text-xs text-nc-text-secondary truncate">{credentials.listName}</p>
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
        </aside>

        {/* Mobile Header */}
        <header className="md:hidden fixed top-0 w-full h-16 border-b border-nc-border/50 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-between px-4">
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
        <main className="flex-1 h-screen overflow-y-auto w-full relative custom-scrollbar flex flex-col">
          {renderView()}
        </main>
      </div>
    </XtreamProvider>
  );
}
