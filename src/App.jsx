import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Toaster, ToastBar } from 'react-hot-toast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ResetCredential from './pages/ResetCredential';
import { getAuthToken, clearAuthToken } from './services/apiClient';
import './App.css';

function App() {
  // Check sessionStorage for logged in status
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('isLoggedIn') === 'true' || Boolean(getAuthToken());
  });
  
  const navigate = useNavigate();
  const location = useLocation();
  const isPublicRoute = ['/login', '/reset-password', '/reset-pin'].includes(location.pathname);

  useEffect(() => {
    // If user is not authenticated and tries to access protected route (anything not /login), redirect
    if (!isAuthenticated && !isPublicRoute) {
         navigate('/login', { replace: true });
    }
    // If user IS authenticated and tries to go to login, redirect to dashboard home
    if (isAuthenticated && (location.pathname === '/login' || location.pathname === '/reset-password' || location.pathname === '/reset-pin')) {
         navigate('/', { replace: true });
    }
  }, [isAuthenticated, isPublicRoute, location.pathname, navigate]);

  const handleLogin = () => {
    sessionStorage.setItem('isLoggedIn', 'true');
    setIsAuthenticated(true);
    navigate('/', { replace: true });
  };

  const handleLogout = () => {
    // wipe all session-based user state so next login starts clean
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('userRole');
    sessionStorage.removeItem('userName');
    sessionStorage.removeItem('userAvatar');
    clearAuthToken();
    setIsAuthenticated(false);
    navigate('/login', { replace: true });
  };

  return (
    <>
      <Toaster 
        position="top-right" 
        toastOptions={{
          className: '',
          duration: 3000,
          style: {
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '8px 12px',
            color: '#fff',
            fontSize: '12px',
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            fontWeight: '600',
            borderRadius: '12px',
            boxShadow: '0 10px 30px -10px rgba(0, 0, 0, 0.5)',
            maxWidth: '300px',
            width: 'auto',
          },
          success: {
            iconTheme: {
              primary: '#fff',
              secondary: '#000',
            },
            duration: 3000,
          },
          error: {
             iconTheme: {
              primary: '#fff',
              secondary: '#000',
            },
            duration: 3000,
          }
        }}
      >
        {(t) => (
          <ToastBar toast={t}>
            {({ icon, message }) => (
              <div className="flex flex-col w-full relative min-w-60">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="shrink-0 scale-100">{icon}</span>
                  <div className="text-xs font-bold leading-relaxed">{message}</div>
                </div>
                {t.type !== 'loading' && t.duration !== Infinity && (
                  <div className="h-0.5 w-full bg-white/10 mt-auto">
                     <div 
                        className="h-full bg-white"
                        style={{ 
                          animation: `toast-progress ${t.duration}ms linear forwards`, 
                          width: '100%' 
                        }} 
                     />
                  </div>
                )}
              </div>
            )}
          </ToastBar>
        )}
      </Toaster>
      
      <Routes>
        <Route path="/login" element={
          !isAuthenticated ? <Login onLogin={handleLogin} /> : <Navigate to="/" replace />
        } />
        <Route path="/reset-password" element={
          !isAuthenticated ? <ResetCredential mode="password" /> : <Navigate to="/" replace />
        } />
        <Route path="/reset-pin" element={
          !isAuthenticated ? <ResetCredential mode="pin" /> : <Navigate to="/" replace />
        } />
        <Route path="/*" element={
          isAuthenticated ? <Dashboard onLogout={handleLogout} /> : <Navigate to="/login" replace />
        } />
      </Routes>
    </>
  );
}

export default App;
