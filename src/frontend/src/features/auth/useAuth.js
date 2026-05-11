/**
 * Re-export of the existing AuthContext hook so feature code can stay in
 * the new `features/auth` namespace without churning the context module.
 */

export { useAuth, AuthProvider, withAuth } from '../../contexts/AuthContext.jsx';
