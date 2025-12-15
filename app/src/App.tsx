import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import SiteSearch from './pages/SiteSearch';
import SiteDetail from './pages/SiteDetail';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route
            path="/search"
            element={
              <ProtectedRoute>
                <SiteSearch />
              </ProtectedRoute>
            }
          />
          <Route
            path="/site/:siteId"
            element={
              <ProtectedRoute>
                <SiteDetail />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
