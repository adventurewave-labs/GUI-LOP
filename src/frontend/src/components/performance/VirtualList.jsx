/**
 * Virtual scrolling component for large lists
 * Efficiently renders only visible items for optimal performance
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const VirtualList = React.memo(({
  items = [],
  itemHeight = 50,
  containerHeight = 400,
  overscan = 5,
  renderItem,
  getItemKey = (item, index) => index,
  onScroll,
  className = '',
  ...props
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: containerHeight });
  const containerRef = useRef(null);
  const scrollElementRef = useRef(null);

  // Calculate visible range
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerSize.height) / itemHeight) + overscan
    );

    return { startIndex, endIndex };
  }, [scrollTop, itemHeight, containerSize.height, overscan, items.length]);

  // Calculate total height
  const totalHeight = useMemo(() => {
    return items.length * itemHeight;
  }, [items.length, itemHeight]);

  // Visible items
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.startIndex, visibleRange.endIndex + 1).map((item, index) => {
      const actualIndex = visibleRange.startIndex + index;
      return {
        item,
        index: actualIndex,
        key: getItemKey(item, actualIndex),
        style: {
          position: 'absolute',
          top: actualIndex * itemHeight,
          left: 0,
          right: 0,
          height: itemHeight
        }
      };
    });
  }, [items, visibleRange, itemHeight, getItemKey]);

  // Handle scroll event
  const handleScroll = useCallback((e) => {
    const newScrollTop = e.target.scrollTop;
    setScrollTop(newScrollTop);
    onScroll?.(e);
  }, [onScroll]);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Scroll to index
  const scrollToIndex = useCallback((index, behavior = 'smooth') => {
    if (scrollElementRef.current) {
      const scrollTop = index * itemHeight;
      scrollElementRef.current.scrollTo({
        top: scrollTop,
        behavior
      });
    }
  }, [itemHeight]);

  // Scroll to top
  const scrollToTop = useCallback((behavior = 'smooth') => {
    scrollToIndex(0, behavior);
  }, [scrollToIndex]);

  // Scroll to bottom
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    scrollToIndex(items.length - 1, behavior);
  }, [scrollToIndex, items.length]);

  // Get scroll position
  const getScrollPosition = useCallback(() => {
    return {
      scrollTop,
      scrollPercentage: totalHeight > 0 ? (scrollTop / (totalHeight - containerSize.height)) * 100 : 0,
      visibleRange
    };
  }, [scrollTop, totalHeight, containerSize.height, visibleRange]);

  return (
    <div
      ref={containerRef}
      className={`virtual-list-container ${className}`}
      style={{
        height: containerHeight,
        overflow: 'auto',
        position: 'relative'
      }}
      onScroll={handleScroll}
      {...props}
    >
      <div
        ref={scrollElementRef}
        style={{
          height: totalHeight,
          position: 'relative'
        }}
      >
        {visibleItems.map(({ item, index, key, style }) => (
          <div
            key={key}
            style={style}
            className="virtual-list-item"
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
});

VirtualList.displayName = 'VirtualList';

// Hook for virtual list state management
export const useVirtualList = (items, options = {}) => {
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [expandedItems, setExpandedItems] = useState(new Set());

  const {
    itemHeight = 50,
    containerHeight = 400,
    overscan = 5
  } = options;

  // Select item
  const selectItem = useCallback((index) => {
    setSelectedIndex(index);
  }, []);

  // Toggle item expansion
  const toggleExpanded = useCallback((index) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIndex(-1);
  }, []);

  // Select next item
  const selectNext = useCallback(() => {
    setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
  }, [items.length]);

  // Select previous item
  const selectPrevious = useCallback(() => {
    setSelectedIndex(prev => Math.max(prev - 1, 0));
  }, []);

  // Is item expanded
  const isExpanded = useCallback((index) => {
    return expandedItems.has(index);
  }, [expandedItems]);

  return {
    selectedIndex,
    expandedItems,
    selectItem,
    toggleExpanded,
    clearSelection,
    selectNext,
    selectPrevious,
    isExpanded,
    virtualListProps: {
      items,
      itemHeight,
      containerHeight,
      overscan
    }
  };
};

// Workflow list component using virtual scrolling
export const VirtualWorkflowList = React.memo(({
  workflows = [],
  onWorkflowSelect,
  onWorkflowExecute,
  selectedWorkflowId = null,
  className = ''
}) => {
  const {
    selectedIndex,
    selectItem,
    virtualListProps
  } = useVirtualList(workflows, {
    itemHeight: 80,
    containerHeight: 400,
    overscan: 3
  });

  const renderWorkflow = useCallback((workflow, index) => {
    const isSelected = selectedIndex === index || workflow.id === selectedWorkflowId;

    return (
      <div
        className={`workflow-virtual-item ${isSelected ? 'selected' : ''}`}
        style={{
          padding: '12px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          backgroundColor: isSelected ? '#e7f3ff' : 'white',
          cursor: 'pointer',
          transition: 'all 0.2s ease'
        }}
        onClick={() => {
          selectItem(index);
          onWorkflowSelect?.(workflow);
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
          {workflow.name}
        </div>
        <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '8px' }}>
          {workflow.description}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: '#999' }}>
            ID: {workflow.id}
          </span>
          <button
            className="btn btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              onWorkflowExecute?.(workflow);
            }}
            style={{
              padding: '4px 8px',
              fontSize: '0.75rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer'
            }}
          >
            Execute
          </button>
        </div>
      </div>
    );
  }, [selectedIndex, selectedWorkflowId, selectItem, onWorkflowSelect, onWorkflowExecute]);

  return (
    <VirtualList
      {...virtualListProps}
      renderItem={renderWorkflow}
      className={`virtual-workflow-list ${className}`}
      getItemKey={(workflow) => workflow.id}
    />
  );
});

VirtualWorkflowList.displayName = 'VirtualWorkflowList';

export default VirtualList;