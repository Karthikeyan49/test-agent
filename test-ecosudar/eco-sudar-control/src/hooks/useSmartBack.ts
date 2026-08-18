import { useNavigate } from 'react-router-dom';

export function useSmartBack(fallback: string) {
  const navigate = useNavigate();
  return () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  };
}

export default useSmartBack;
