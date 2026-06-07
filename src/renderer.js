import { aggregateData, buildRowHierarchy, aggregationTypes, getCellValue as getAggCellValue } from './aggregator.js';

const ROW_HEIGHT = 36;
const HEADER_ROW_HEIGHT = 36;
const BUFFER_ROWS = 5;
const VIRTUAL_THRESHOLD = 200;

export class PivotRenderer {
  constructor(container, data) {
    this.container = container;
    this.rawData = data;
    this.config = {
      rows: [],
      columns: [],
      values: [],
      filters: []
    };
    this.collapsedNodes = new Set();
    this.highlightedCell = null;
    this.onCellDoubleClick = null;
    this.onRowToggle = null;
    this.scrollTop = 0;
    this.visibleRows = [];
    this.allRows = [];
    this.scrollHandlerAttached = false;
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
    this.render();
  }

  setExpanded(key, expanded) {
    if (expanded) {
      this.collapsedNodes.delete(key);
    } else {
      this.collapsedNodes.add(key);
    }
  }

  isExpanded(key) {
    return !this.collapsedNodes.has(key);
  }

  toggleExpand(key) {
    if (this.isExpanded(key)) {
      this.collapsedNodes.add(key);
    } else {
      this.collapsedNodes.delete(key);
    }
    this.render();
  }

  buildVisibleRows() {
    const { rows } = this.config;
    
    if (this.config.values.length === 0) {
      this.allRows = [];
      return [];
    }
    
    const result = aggregateData(this.rawData, this.config);
    this.aggregateResult = result;
    
    const allRows = [];
    
    const addRow = (node, level) => {
      allRows.push({
        key: node.key,
        label: node.label,
        level,
        isSubtotal: false,
        isGrandTotal: false,
        values: node.values,
        hasChildren: node.children && node.children.length > 0
      });
      
      if (this.isExpanded(node.key) && node.children && node.children.length > 0) {
        node.children.forEach(child => {
          addRow(child, level + 1);
        });
        
        if (rows.length > 1) {
          allRows.push({
            key: `${node.key}__subtotal`,
            label: `${node.label} 小计`,
            level,
            isSubtotal: true,
            isGrandTotal: false,
            values: node.values,
            hasChildren: false
          });
        }
      }
    };
    
    if (rows.length > 0) {
      const hierarchy = buildRowHierarchy(result.rowKeys, rows);
      hierarchy.forEach(node => {
        addRow(node, 0);
      });
    } else {
      allRows.push({
        key: '__total__',
        label: '总计',
        level: 0,
        isSubtotal: false,
        isGrandTotal: false,
        values: [],
        hasChildren: false
      });
    }
    
    if (rows.length > 0) {
      allRows.push({
        key: '__grand_total__',
        label: '总计',
        level: 0,
        isSubtotal: false,
        isGrandTotal: true,
        values: [],
        hasChildren: false
      });
    }
    
    this.allRows = allRows;
    return allRows;
  }

  buildColumnHeaders() {
    const { columns, values } = this.config;
    const result = this.aggregateResult;
    
    if (!result) return [];
    
    const headers = [];
    
    if (columns.length === 0) {
      const row = [];
      values.forEach((v, vIdx) => {
        row.push({
          label: v.label || `${aggregationTypes[v.aggregation].label}(${v.field})`,
          colSpan: 1,
          key: `val_${vIdx}`,
          valueIndex: vIdx,
          colKeyObj: { key: '__total__' }
        });
      });
      headers.push(row);
    } else {
      const allColCombos = [];
      result.columnKeys.forEach(colKey => {
        values.forEach((v, vIdx) => {
          allColCombos.push({
            colKey,
            valueConfig: v,
            valueIndex: vIdx
          });
        });
      });
      
      values.forEach((v, vIdx) => {
        allColCombos.push({
          colKey: { key: '__total__', values: [], isTotal: true },
          valueConfig: v,
          valueIndex: vIdx
        });
      });
      
      for (let level = 0; level < columns.length; level++) {
        const levelHeaders = [];
        let lastKey = null;
        let lastLabel = null;
        let spanCount = 0;
        
        allColCombos.forEach((combo, idx) => {
          const val = combo.colKey.values ? combo.colKey.values[level] : null;
          const key = val || (combo.colKey.isTotal ? '__total__' : null);
          const label = val || (combo.colKey.isTotal ? '总计' : '');
          
          if (key !== lastKey) {
            if (lastKey !== null) {
              levelHeaders.push({ label: lastLabel, colSpan: spanCount, key: lastKey });
            }
            lastKey = key;
            lastLabel = label;
            spanCount = 1;
          } else {
            spanCount++;
          }
          
          if (idx === allColCombos.length - 1) {
            levelHeaders.push({ label: lastLabel, colSpan: spanCount, key: lastKey });
          }
        });
        
        headers.push(levelHeaders);
      }
      
      const lastLevel = [];
      allColCombos.forEach(combo => {
        lastLevel.push({
          label: combo.valueConfig.label || `${aggregationTypes[combo.valueConfig.aggregation].label}(${combo.valueConfig.field})`,
          colSpan: 1,
          colKeyObj: combo.colKey,
          valueIndex: combo.valueIndex,
          key: `${combo.colKey.key}__${combo.valueIndex}`
        });
      });
      headers.push(lastLevel);
    }
    
    return headers;
  }

  render() {
    this.buildVisibleRows();
    
    if (this.allRows.length === 0 || this.config.values.length === 0) {
      this.renderEmptyState();
      return;
    }
    
    const columnHeaders = this.buildColumnHeaders();
    const useVirtualScroll = this.allRows.length > VIRTUAL_THRESHOLD;
    
    if (useVirtualScroll) {
      this.renderVirtualScroll(columnHeaders);
    } else {
      this.renderFullTable(columnHeaders);
    }
  }

  renderEmptyState() {
    this.container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3h18v18H3z"></path>
          <path d="M3 9h18"></path>
          <path d="M9 3v18"></path>
        </svg>
        <p>拖拽字段到行、列、值区域开始分析</p>
      </div>
    `;
  }

  renderFullTable(columnHeaders) {
    const { rows, values } = this.config;
    const numRowHeaderCols = Math.max(rows.length, 1);
    
    let html = '<table>';
    html += '<thead>';
    
    columnHeaders.forEach((headerRow, levelIdx) => {
      html += '<tr>';
      
      if (levelIdx === columnHeaders.length - 1) {
        if (rows.length > 0) {
          rows.forEach(r => {
            html += `<th class="row-header corner">${r}</th>`;
          });
        } else {
          html += `<th class="row-header corner">项目</th>`;
        }
      } else {
        html += `<th class="row-header corner" colspan="${numRowHeaderCols}"></th>`;
      }
      
      headerRow.forEach(header => {
        html += `<th colspan="${header.colSpan}">${header.label}</th>`;
      });
      
      html += '</tr>';
    });
    
    html += '</thead><tbody>';
    
    this.allRows.forEach(row => {
      html += this.renderRow(row);
    });
    
    html += '</tbody></table>';
    
    this.container.innerHTML = html;
    this.attachEventListeners();
  }

  renderRow(row) {
    const { rows, values } = this.config;
    let html = '<tr>';
    
    if (rows.length > 0) {
      for (let colIdx = 0; colIdx < rows.length; colIdx++) {
        let content = '';
        
        if (colIdx === 0) {
          content = this.renderRowHeaderCell(row);
        } else if (colIdx === row.level + 1 && !row.isSubtotal && !row.isGrandTotal) {
          if (row.level >= colIdx - 1) {
            content = row.values[colIdx] || '';
          }
        } else if (colIdx <= row.level && !row.isSubtotal && !row.isGrandTotal) {
          content = row.values[colIdx] || '';
        }
        
        let cellClass = 'row-header';
        if (row.isGrandTotal) cellClass += ' grand-total';
        else if (row.isSubtotal) cellClass += ' subtotal';
        
        html += `<td class="${cellClass}">${content}</td>`;
      }
    } else {
      html += `<td class="row-header${row.isGrandTotal ? ' grand-total' : row.isSubtotal ? ' subtotal' : ''}">${row.label}</td>`;
    }
    
    const allColCombos = this.buildDataColumns();
    allColCombos.forEach(col => {
      const value = this.getCellValue(row, col.colKeyObj, col.valueIndex);
      const displayValue = this.formatValue(value, col.field);
      
      let cellClass = 'data-cell';
      if (row.isGrandTotal) cellClass += ' grand-total';
      else if (row.isSubtotal) cellClass += ' subtotal';
      
      html += `<td class="${cellClass}" 
                  data-row-key="${row.key}" 
                  data-col-key="${col.colKeyObj.key}"
                  data-value-index="${col.valueIndex}">${displayValue}</td>`;
    });
    
    html += '</tr>';
    return html;
  }

  buildDataColumns() {
    const { columns, values } = this.config;
    const result = this.aggregateResult;
    const combos = [];
    
    if (columns.length === 0) {
      values.forEach((v, vIdx) => {
        combos.push({
          colKeyObj: { key: '__total__' },
          valueIndex: vIdx,
          field: v.field
        });
      });
    } else {
      result.columnKeys.forEach(colKey => {
        values.forEach((v, vIdx) => {
          combos.push({
            colKeyObj: colKey,
            valueIndex: vIdx,
            field: v.field
          });
        });
      });
      
      values.forEach((v, vIdx) => {
        combos.push({
          colKeyObj: { key: '__total__', isTotal: true },
          valueIndex: vIdx,
          field: v.field
        });
      });
    }
    
    return combos;
  }

  renderRowHeaderCell(row) {
    let html = '';
    
    for (let i = 0; i < row.level; i++) {
      html += '<span class="row-indent"></span>';
    }
    
    if (row.hasChildren) {
      const expanded = this.isExpanded(row.key);
      html += `<span class="expand-btn" data-key="${row.key}">${expanded ? '▼' : '▶'}</span>`;
    } else if (!row.isSubtotal && !row.isGrandTotal) {
      html += '<span class="expand-btn" style="visibility: hidden;"></span>';
    }
    
    html += row.label;
    
    return html;
  }

  getCellValue(row, colKeyObj, valueIndex) {
    if (!this.aggregateResult) return '';
    
    let rowValues = [];
    if (!row.isGrandTotal) {
      const cleanKey = row.isSubtotal ? row.key.replace('__subtotal', '') : row.key;
      rowValues = cleanKey.split('||').filter(v => v);
    }
    
    let colValues = [];
    if (colKeyObj && !colKeyObj.isTotal && colKeyObj.key !== '__total__') {
      colValues = colKeyObj.values || [];
    }
    
    return getAggCellValue(this.aggregateResult, rowValues, colValues, valueIndex);
  }

  formatValue(value, field) {
    if (value === '' || value === null || value === undefined || value === NaN) return '-';
    
    if (field === '利润率') {
      return (value * 100).toFixed(2) + '%';
    }
    
    if (typeof value === 'number') {
      if (Math.abs(value) >= 1000) {
        return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
      }
      return value.toFixed(2);
    }
    
    return value;
  }

  renderVirtualScroll(columnHeaders) {
    const { rows, values } = this.config;
    const numRowHeaderCols = Math.max(rows.length, 1);
    
    const containerHeight = this.container.clientHeight || 400;
    const headerHeight = columnHeaders.length * HEADER_ROW_HEIGHT;
    const bodyHeight = containerHeight - headerHeight;
    
    const totalBodyRows = this.allRows.length;
    const totalBodyHeight = totalBodyRows * ROW_HEIGHT;
    
    const visibleRowCount = Math.ceil(bodyHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
    const startIndex = Math.max(0, Math.floor(this.scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const endIndex = Math.min(totalBodyRows, startIndex + visibleRowCount);
    
    this.visibleRows = this.allRows.slice(startIndex, endIndex);
    
    let html = '<div style="position: relative; width: max-content; min-width: 100%;">';
    
    html += '<div style="position: sticky; top: 0; z-index: 20; background: white;">';
    html += '<table style="table-layout: fixed;">';
    html += '<thead>';
    
    columnHeaders.forEach((headerRow, levelIdx) => {
      html += '<tr>';
      if (levelIdx === columnHeaders.length - 1) {
        if (rows.length > 0) {
          rows.forEach(r => {
            html += `<th class="row-header corner">${r}</th>`;
          });
        } else {
          html += `<th class="row-header corner">项目</th>`;
        }
      } else {
        html += `<th class="row-header corner" colspan="${numRowHeaderCols}"></th>`;
      }
      headerRow.forEach(header => {
        html += `<th colspan="${header.colSpan}">${header.label}</th>`;
      });
      html += '</tr>';
    });
    
    html += '</thead></table></div>';
    
    html += `<div style="height: ${totalBodyHeight}px; position: relative;">`;
    html += `<div style="position: absolute; top: ${startIndex * ROW_HEIGHT}px; width: 100%;">`;
    html += '<table style="table-layout: fixed; width: 100%;"><tbody>';
    
    this.visibleRows.forEach(row => {
      html += this.renderRow(row);
    });
    
    html += '</tbody></table></div></div></div>';
    
    this.container.innerHTML = html;
    this.attachEventListeners();
    
    if (!this.scrollHandlerAttached) {
      this.container.addEventListener('scroll', () => {
        this.scrollTop = this.container.scrollTop;
        if (this.allRows.length > VIRTUAL_THRESHOLD) {
          this.renderVirtualScroll(columnHeaders);
        }
      });
      this.scrollHandlerAttached = true;
    }
  }

  attachEventListeners() {
    this.container.querySelectorAll('.expand-btn[data-key]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        this.toggleExpand(key);
        if (this.onRowToggle) {
          this.onRowToggle(key, this.isExpanded(key));
        }
      };
    });
    
    this.container.querySelectorAll('.data-cell').forEach(cell => {
      cell.onclick = () => {
        this.highlightCell(cell);
      };
      
      cell.ondblclick = () => {
        if (this.onCellDoubleClick) {
          const rowKey = cell.dataset.rowKey;
          const colKey = cell.dataset.colKey;
          const valueIndex = parseInt(cell.dataset.valueIndex);
          this.onCellDoubleClick(rowKey, colKey, valueIndex);
        }
      };
    });
  }

  highlightCell(cell) {
    this.container.querySelectorAll('.highlighted').forEach(c => {
      c.classList.remove('highlighted');
    });
    
    cell.classList.add('highlighted');
    this.highlightedCell = cell;
    
    const row = cell.closest('tr');
    if (row) {
      row.querySelectorAll('.row-header').forEach(header => {
        header.classList.add('highlighted');
      });
    }
    
    const cellIndex = Array.from(cell.parentNode.children).indexOf(cell);
    if (cellIndex >= 0) {
      this.container.querySelectorAll('thead tr').forEach(headerRow => {
        const headers = headerRow.querySelectorAll('th');
        if (headers[cellIndex]) {
          headers[cellIndex].classList.add('highlighted');
        }
      });
    }
  }
}
