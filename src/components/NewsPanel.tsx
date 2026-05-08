import { useEffect, useRef, useState } from 'react';
import type { NewsArticle } from '../types';

interface NewsPanelProps {
  articles: NewsArticle[] | undefined;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) {
    return 'Just now';
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

export default function NewsPanel({ articles, isLoading, error, onClose }: NewsPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 80 });
  const [size, setSize] = useState({ width: 480, height: 500 });
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [articles]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.news-header-actions')) return;
    
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      
      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;
      
      setPosition({
        x: dragStartRef.current.posX + deltaX,
        y: dragStartRef.current.posY + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleResize = (delta: { width?: number; height?: number }) => {
    setSize(prev => ({
      width: Math.max(320, (delta.width ?? 0) + prev.width),
      height: Math.max(200, (delta.height ?? 0) + prev.height),
    }));
  };

  return (
    <div
      ref={panelRef}
      className="news-panel-floating"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      <div className="news-panel-header" onMouseDown={handleMouseDown}>
        <h3 className="news-panel-title">
          📰 News {articles && `(${articles.length})`}
        </h3>
        <div className="news-header-actions">
          <button
            className="news-action-btn"
            onClick={() => handleResize({ width: 100 })}
            title="Expand width"
          >
            ⬚
          </button>
          <button
            className="news-action-btn"
            onClick={() => handleResize({ width: -100 })}
            title="Shrink width"
          >
            ›
          </button>
          <button
            className="news-close-btn"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="news-panel-body" ref={contentRef}>
        {error && (
          <div className="news-panel-error">
            Failed to load news: {error}
          </div>
        )}

        {isLoading && (!articles || articles.length === 0) && (
          <div className="news-panel-loading">
            Loading news…
          </div>
        )}

        {!isLoading && !error && (!articles || articles.length === 0) && (
          <div className="news-panel-empty">
            No recent news available
          </div>
        )}

        {articles && articles.length > 0 && (
          <div className="news-articles-list">
            {articles.map((article, idx) => (
              <a
                key={`${article.published_time}-${idx}`}
                href={article.article_link}
                target="_blank"
                rel="noopener noreferrer"
                className="news-article-item"
              >
                <div className="news-article-content">
                  <div className="news-article-header">
                    <h4 className="news-article-title">{article.heading}</h4>
                    <span className="news-article-time">
                      {formatTimestamp(article.published_time)}
                    </span>
                  </div>
                  <p className="news-article-summary">{article.summary}</p>
                </div>
                {article.thumbnail && (
                  <img
                    src={article.thumbnail}
                    alt=""
                    className="news-article-thumbnail"
                    loading="lazy"
                  />
                )}
              </a>
            ))}
          </div>
        )}
      </div>

      <div
        className="news-panel-resize-handle"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;

          const handleMouseMove = (e: MouseEvent) => {
            handleResize({
              width: e.clientX - startX,
              height: e.clientY - startY,
            });
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />
    </div>
  );
}
