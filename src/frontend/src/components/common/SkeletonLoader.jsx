/**
 * Skeleton loading components for progressive loading states
 * Provides visual feedback during content loading
 */

import React from 'react';

// Base skeleton component
export const Skeleton = React.memo(({
  width = '100%',
  height = '1em',
  className = '',
  variant = 'text',
  animation = 'pulse',
  ...props
}) => {
  const variantClasses = {
    text: 'skeleton-text',
    circular: 'skeleton-circular',
    rectangular: 'skeleton-rectangular',
    rounded: 'skeleton-rounded'
  };

  const animationClasses = {
    pulse: 'skeleton-pulse',
    wave: 'skeleton-wave',
    false: ''
  };

  return (
    <span
      className={`skeleton ${variantClasses[variant]} ${animationClasses[animation]} ${className}`}
      style={{
        width,
        height,
        display: 'inline-block',
        backgroundColor: '#e0e0e0',
        borderRadius: variant === 'circular' ? '50%' : variant === 'rounded' ? '4px' : '0',
        position: 'relative',
        overflow: 'hidden'
      }}
      {...props}
    >
      <style jsx>{`
        .skeleton-pulse {
          animation: skeleton-pulse 1.5s ease-in-out infinite;
        }

        .skeleton-wave::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.6),
            transparent
          );
          animation: skeleton-wave 1.5s ease-in-out infinite;
        }

        @keyframes skeleton-pulse {
          0% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
          100% {
            opacity: 1;
          }
        }

        @keyframes skeleton-wave {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </span>
  );
});

Skeleton.displayName = 'Skeleton';

// Text skeleton with multiple lines
export const TextSkeleton = React.memo(({
  lines = 3,
  width = ['100%', '90%', '80%'],
  height = '1em',
  className = '',
  ...props
}) => {
  return (
    <div className={`text-skeleton ${className}`} {...props}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          width={width[index] || width[width.length - 1]}
          height={height}
          style={{ marginBottom: '0.5em' }}
        />
      ))}
    </div>
  );
});

TextSkeleton.displayName = 'TextSkeleton';

// Card skeleton
export const CardSkeleton = React.memo(({
  avatar = true,
  title = true,
  subtitle = true,
  content = true,
  actions = true,
  className = '',
  ...props
}) => {
  return (
    <div className={`card-skeleton ${className}`} {...props}>
      <div style={{ padding: '1rem', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
        {avatar && (
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
            <Skeleton
              variant="circular"
              width={40}
              height={40}
              style={{ marginRight: '1rem' }}
            />
            <div style={{ flex: 1 }}>
              {title && <Skeleton width="60%" height="1.2em" />}
              {subtitle && <Skeleton width="40%" height="0.9em" style={{ marginTop: '0.25em' }} />}
            </div>
          </div>
        )}

        {content && (
          <div style={{ marginBottom: '1rem' }}>
            <TextSkeleton lines={2} width={['100%', '85%']} />
          </div>
        )}

        {actions && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Skeleton width="80px" height="32px" variant="rounded" />
            <Skeleton width="80px" height="32px" variant="rounded" />
          </div>
        )}
      </div>
    </div>
  );
});

CardSkeleton.displayName = 'CardSkeleton';

// Workflow card skeleton
export const WorkflowCardSkeleton = React.memo(({
  className = '',
  ...props
}) => {
  return (
    <div className={`workflow-card-skeleton ${className}`} {...props}>
      <div style={{
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '1rem',
        backgroundColor: 'white'
      }}>
        <div style={{ marginBottom: '1rem' }}>
          <Skeleton width="70%" height="1.5em" style={{ marginBottom: '0.5rem' }} />
          <TextSkeleton lines={2} width={['100%', '90%']} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Skeleton width="120px" height="0.875em" />
          <Skeleton width="100px" height="32px" variant="rounded" />
        </div>
      </div>
    </div>
  );
});

WorkflowCardSkeleton.displayName = 'WorkflowCardSkeleton';

// List skeleton
export const ListSkeleton = React.memo(({
  items = 5,
  avatar = true,
  showActions = true,
  className = '',
  ...props
}) => {
  return (
    <div className={`list-skeleton ${className}`} {...props}>
      {Array.from({ length: items }).map((_, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '1rem',
            borderBottom: '1px solid #e0e0e0'
          }}
        >
          {avatar && (
            <Skeleton
              variant="circular"
              width={32}
              height={32}
              style={{ marginRight: '1rem' }}
            />
          )}

          <div style={{ flex: 1 }}>
            <Skeleton width="60%" height="1em" style={{ marginBottom: '0.25rem' }} />
            <Skeleton width="40%" height="0.875em" />
          </div>

          {showActions && (
            <Skeleton width="80px" height="28px" variant="rounded" />
          )}
        </div>
      ))}
    </div>
  );
});

ListSkeleton.displayName = 'ListSkeleton';

// Table skeleton
export const TableSkeleton = React.memo(({
  rows = 5,
  columns = 4,
  showHeader = true,
  className = '',
  ...props
}) => {
  return (
    <div className={`table-skeleton ${className}`} {...props}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {showHeader && (
          <thead>
            <tr>
              {Array.from({ length: columns }).map((_, index) => (
                <th key={index} style={{ padding: '1rem', borderBottom: '2px solid #e0e0e0' }}>
                  <Skeleton height="1.2em" />
                </th>
              ))}
            </tr>
          </thead>
        )}

        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columns }).map((_, colIndex) => (
                <td key={colIndex} style={{ padding: '1rem', borderBottom: '1px solid #e0e0e0' }}>
                  <Skeleton height="1em" width={`${80 + Math.random() * 20}%`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

TableSkeleton.displayName = 'TableSkeleton';

// Dashboard skeleton
export const DashboardSkeleton = React.memo(({
  className = '',
  ...props
}) => {
  return (
    <div className={`dashboard-skeleton ${className}`} {...props}>
      <div style={{ marginBottom: '2rem' }}>
        <Skeleton width="30%" height="2em" style={{ marginBottom: '1rem' }} />
        <TextSkeleton lines={2} width={['80%', '60%']} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} style={{ padding: '1.5rem', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
            <Skeleton width="40%" height="1.5em" style={{ marginBottom: '1rem' }} />
            <Skeleton width="60%" height="2em" style={{ marginBottom: '0.5rem' }} />
            <Skeleton width="80%" height="0.875em" />
          </div>
        ))}
      </div>

      <div>
        <Skeleton width="25%" height="1.5em" style={{ marginBottom: '1rem' }} />
        <ListSkeleton items={3} avatar={false} />
      </div>
    </div>
  );
});

DashboardSkeleton.displayName = 'DashboardSkeleton';

// Progressive loading wrapper
export const ProgressiveLoader = React.memo(({
  children,
  loading = false,
  delay = 200,
  skeleton = <TextSkeleton />,
  fallback = null,
  className = '',
  ...props
}) => {
  const [showSkeleton, setShowSkeleton] = React.useState(false);
  const timeoutRef = React.useRef(null);

  React.useEffect(() => {
    if (loading) {
      timeoutRef.current = setTimeout(() => {
        setShowSkeleton(true);
      }, delay);
    } else {
      setShowSkeleton(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [loading, delay]);

  if (!loading) {
    return children;
  }

  if (!showSkeleton) {
    return fallback || null;
  }

  return (
    <div className={`progressive-loader ${className}`} {...props}>
      {skeleton}
    </div>
  );
});

ProgressiveLoader.displayName = 'ProgressiveLoader';

// Lazy image with skeleton
export const LazyImage = React.memo(({
  src,
  alt,
  width,
  height,
  className = '',
  skeletonWidth = width,
  skeletonHeight = height,
  ...props
}) => {
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [inView, setInView] = React.useState(false);
  const imgRef = React.useRef(null);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const handleLoad = React.useCallback(() => {
    setLoaded(true);
    setError(false);
  }, []);

  const handleError = React.useCallback(() => {
    setLoaded(true);
    setError(true);
  }, []);

  if (!inView) {
    return (
      <div
        ref={imgRef}
        style={{ width, height }}
        className={`lazy-image-placeholder ${className}`}
      >
        <Skeleton width={skeletonWidth} height={skeletonHeight} />
      </div>
    );
  }

  return (
    <div className={`lazy-image-container ${className}`} style={{ width, height }}>
      {!loaded && (
        <Skeleton
          width={skeletonWidth}
          height={skeletonHeight}
          style={{ position: 'absolute' }}
        />
      )}
      {error ? (
        <div
          style={{
            width,
            height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#f5f5f5',
            color: '#999',
            fontSize: '0.875rem'
          }}
        >
          Failed to load image
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          onLoad={handleLoad}
          onError={handleError}
          style={{
            width,
            height,
            objectFit: 'cover',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.3s ease'
          }}
          {...props}
        />
      )}
    </div>
  );
});

LazyImage.displayName = 'LazyImage';

export default Skeleton;