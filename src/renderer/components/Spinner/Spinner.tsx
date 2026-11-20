import { Box, CircularProgress } from '@mui/material';
import { BRAND } from 'renderer/brand';

interface SpinnerProps {
  size?: string | number;
  color?: string;
  className?: string;
}

export default function Spinner({
  size = '10vh',
  color = BRAND,
  className = '',
}: SpinnerProps) {
  return (
    <Box
      className={className}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
      }}
    >
      <CircularProgress size={size} sx={{ color }} />
    </Box>
  );
}
