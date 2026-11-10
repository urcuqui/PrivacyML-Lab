import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Compass, History, Moon, Sun, Menu, ShieldQuestion, GraduationCap } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useRoute, href, navigate } from '@/lib/router';
import { usePersistentState } from '@/lib/store';
import { EXPERIMENTS, MODULES, findExperiment, type ModuleId } from '@/modules/registry';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const Overview = lazy(() => import('@/modules/overview/Overview'));
const Journey = lazy(() => import('@/modules/journey/Journey'));
const KnowledgeCheck = lazy(() => import('@/modules/quiz/KnowledgeCheck'));
const HistoryPage = lazy(() => import('@/modules/history/HistoryPage'));
const Limits = lazy(() => import('@/modules/limits/Limits'));
const Agentic = lazy(() => import('@/modules/agentic/Agentic'));

const NAV: { label: string; path: string; match: (p: string) => boolean }[] = [
  { label: 'Inicio', path: '/', match: (p) => p === '/' },
  { label: 'Privacidad Diferencial', path: '/dp/1', match: (p) => p.startsWith('/dp') },
  { label: 'Aprendizaje Federado', path: '/fl/1', match: (p) => p.startsWith('/fl') },
  { label: 'Experimento combinado', path: '/combined', match: (p) => p.startsWith('/combined') },
  { label: 'IA agéntica', path: '/agentic', match: (p) => p.startsWith('/agentic') },
  { label: 'Evaluación', path: '/quiz', match: (p) => p.startsWith('/quiz') },
];

function useTheme() {
  const [theme, setTheme] = usePersistentState<'light' | 'dark'>('theme', 'light');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  return [theme, setTheme] as const;
}

function Logo() {
  return (
    <a href={href('/')} className="flex items-center gap-2 font-semibold tracking-tight" aria-label="Privacy-Preserving ML Lab — inicio">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="7" className="fill-primary" />
        <path d="M16 6l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V9z" fill="none" stroke="hsl(var(--fl))" strokeWidth="2" />
        <circle cx="16" cy="15" r="2.5" fill="hsl(var(--warn))" />
      </svg>
      <span className="hidden text-sm sm:inline">
        Privacy-Preserving ML <span className="text-muted-foreground">Lab</span>
      </span>
    </a>
  );
}

function Header({ path }: { path: string }) {
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-3 px-4">
        <Logo />
        <nav aria-label="Navegación principal" className="ml-4 hidden items-center gap-0.5 xl:flex">
          {NAV.map((n) => (
            <a key={n.path} href={href(n.path)} aria-current={n.match(path) ? 'page' : undefined} className={cn('rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent', n.match(path) ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground')}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <a href={href('/journey')} aria-current={path === '/journey' ? 'page' : undefined}>
              <Compass /> <span className="hidden md:inline">Ruta guiada</span>
            </a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={href('/history')} aria-current={path === '/history' ? 'page' : undefined}>
              <History /> <span className="hidden md:inline">Historial</span>
            </a>
          </Button>
          <Button variant="ghost" size="icon" aria-label={theme === 'dark' ? 'Activar tema claro' : 'Activar tema oscuro'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" size="icon" className="xl:hidden" aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Menu />
          </Button>
        </div>
      </div>
      {open && (
        <nav aria-label="Navegación móvil" className="border-t px-4 py-2 xl:hidden">
          {NAV.map((n) => (
            <a key={n.path} href={href(n.path)} onClick={() => setOpen(false)} className={cn('block rounded-md px-3 py-2 text-sm', n.match(path) ? 'bg-accent font-medium' : 'text-muted-foreground')}>
              {n.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

function ModuleNav({ module, path }: { module: ModuleId; path: string }) {
  const exps = EXPERIMENTS.filter((e) => e.module === module);
  const m = MODULES[module];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className={cn('text-xs font-semibold uppercase tracking-wider', module === 'dp' ? 'text-dp' : module === 'fl' ? 'text-fl' : 'text-primary')}>{m.title}</span>
      {exps.length > 1 && (
        <nav aria-label={`Experimentos de ${m.short}`} className="flex flex-wrap gap-1">
          {exps.map((e) => (
            <a key={e.id} href={href(e.path)} aria-current={e.path === path ? 'page' : undefined} className={cn('rounded-full border px-3 py-1 text-xs transition-colors', e.path === path ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent')}>
              <span className="num mr-1 opacity-70">{e.index}.</span>
              {e.short}
            </a>
          ))}
        </nav>
      )}
      <a href={href(m.quizPath)} aria-current={path === m.quizPath ? 'page' : undefined} className={cn('flex items-center gap-1 rounded-full border px-3 py-1 text-xs', path === m.quizPath ? 'border-primary bg-primary text-primary-foreground' : 'border-dashed hover:bg-accent')}>
        <GraduationCap className="h-3 w-3" aria-hidden /> Comprobación de conocimientos
      </a>
    </div>
  );
}

function PrevNext({ path }: { path: string }) {
  const order = [...EXPERIMENTS.map((e) => e.path)];
  const i = order.indexOf(path);
  if (i < 0) return null;
  const prev = order[i - 1];
  const next = order[i + 1];
  const title = (p: string) => findExperiment(p)?.short ?? '';
  return (
    <div className="mt-6 flex justify-between gap-2">
      {prev ? (
        <Button variant="outline" onClick={() => navigate(prev)}>
          <ArrowLeft /> {title(prev)}
        </Button>
      ) : (
        <span />
      )}
      {next && (
        <Button variant="outline" onClick={() => navigate(next)}>
          {title(next)} <ArrowRight />
        </Button>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground" role="status">
      Cargando…
    </div>
  );
}

function Page({ path }: { path: string }): ReactNode {
  const exp = findExperiment(path);
  if (exp) {
    const C = exp.Component;
    return (
      <>
        <ModuleNav module={exp.module} path={path} />
        <C />
        <PrevNext path={path} />
      </>
    );
  }
  const quiz = path.match(/^\/quiz\/(dp|fl|combined)$/);
  if (quiz) {
    const mod = quiz[1] as ModuleId;
    return (
      <>
        <ModuleNav module={mod} path={path} />
        <KnowledgeCheck module={mod} />
      </>
    );
  }
  switch (path) {
    case '/':
      return <Overview />;
    case '/journey':
      return <Journey />;
    case '/quiz':
      return <KnowledgeCheck module="final" />;
    case '/history':
      return <HistoryPage />;
    case '/limits':
      return <Limits />;
    case '/agentic':
      return <Agentic />;
    default:
      return (
        <div className="rounded-lg border p-6">
          <p className="mb-3">Página no encontrada.</p>
          <Button onClick={() => navigate('/')}>Volver al inicio</Button>
        </div>
      );
  }
}

export default function App() {
  const path = useRoute();
  return (
    <TooltipProvider delayDuration={200}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      <Header path={path} />
      <main id="main" className="lab-grid-bg min-h-[calc(100vh-3.5rem)]">
        <div className="mx-auto max-w-[1500px] px-4 py-6">
          <Suspense fallback={<Loading />}>
            <Page path={path} />
          </Suspense>
        </div>
      </main>
      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground">
          <p>Laboratorio educativo · datos 100 % sintéticos · todo se ejecuta en tu navegador; ningún dato sale de tu equipo.</p>
          <a href={href('/limits')} className="flex items-center gap-1 font-medium text-foreground hover:underline">
            <ShieldQuestion className="h-3.5 w-3.5" aria-hidden /> Lo que esta simulación NO demuestra
          </a>
        </div>
      </footer>
    </TooltipProvider>
  );
}
