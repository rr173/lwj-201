import { salesData, fields } from './data.js';
import { PivotRenderer } from './renderer.js';
import { aggregationTypes, getDistinctValues, getDetailRecords } from './aggregator.js';

class PivotApp {
  constructor() {
    this.rawData = salesData;
    this.fields = fields;
    this.config = {
      rows: ['地区', '产品类别'],
      columns: ['客户等级'],
      values: [
        { field: '销售额', aggregation: 'sum', label: '求和(销售额)' },
        { field: '数量', aggregation: 'sum', label: '求和(数量)' }
      ],
      filters: []
    };
    
    this.renderer = null;
    this.draggedField = null;
    this.draggedZoneField = null;
    
    this.init();
  }
  
  init() {
    this.renderer = new PivotRenderer(
      document.getElementById('pivotTable'),
      this.rawData
    );
    
    this.renderer.onCellDoubleClick = (rowKey, colKey, valueIndex) => {
      this.showDetailModal(rowKey, colKey, valueIndex);
    };
    
    this.renderFieldList();
    this.renderZones();
    this.setupDropZones();
    this.setupModal();
    this.updateRecordCount();
    this.renderPivot();
  }
  
  updateRecordCount() {
    document.getElementById('recordCount').textContent = 
      `共 ${this.rawData.length.toLocaleString()} 条记录`;
  }
  
  renderFieldList() {
    const fieldList = document.getElementById('fieldList');
    fieldList.innerHTML = '';
    
    this.fields.forEach(field => {
      const el = document.createElement('div');
      el.className = `field-item ${field.type}`;
      el.textContent = field.label;
      el.draggable = true;
      el.dataset.field = field.key;
      el.dataset.type = field.type;
      
      el.addEventListener('dragstart', (e) => {
        this.draggedField = field;
        e.dataTransfer.effectAllowed = 'copy';
      });
      
      el.addEventListener('dragend', () => {
        this.draggedField = null;
      });
      
      fieldList.appendChild(el);
    });
  }
  
  setupDropZones() {
    const zones = document.querySelectorAll('.zone-content');
    
    zones.forEach(zone => {
      const zoneType = zone.dataset.zone;
      
      zone.parentNode.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        zone.parentNode.classList.add('drag-over');
      });
      
      zone.parentNode.addEventListener('dragleave', () => {
        zone.parentNode.classList.remove('drag-over');
      });
      
      zone.parentNode.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.parentNode.classList.remove('drag-over');
        
        if (this.draggedZoneField) {
          this.handleZoneFieldDrop(zoneType, this.draggedZoneField);
          this.draggedZoneField = null;
        } else if (this.draggedField) {
          this.handleFieldDrop(zoneType, this.draggedField);
        }
      });
    });
  }
  
  handleFieldDrop(zoneType, field) {
    if (zoneType === 'values') {
      if (field.type !== 'measure') {
        alert('值区域只能放置数值字段');
        return;
      }
      
      const valueConfig = {
        field: field.key,
        aggregation: 'sum',
        label: `${aggregationTypes.sum.label}(${field.label})`
      };
      
      this.config.values.push(valueConfig);
    } else {
      if (zoneType === 'filter') {
        if (!this.config.filters.find(f => f.field === field.key)) {
          this.config.filters.push({
            field: field.key,
            label: field.label,
            values: []
          });
        }
      } else {
        const targetArr = zoneType === 'rows' ? this.config.rows : this.config.columns;
        if (!targetArr.includes(field.key)) {
          targetArr.push(field.key);
          
          const otherArr = zoneType === 'rows' ? this.config.columns : this.config.rows;
          const idx = otherArr.indexOf(field.key);
          if (idx > -1) {
            otherArr.splice(idx, 1);
          }
        }
      }
    }
    
    this.renderZones();
    this.renderPivot();
  }
  
  handleZoneFieldDrop(targetZone, zoneField) {
    const { field, sourceZone, index } = zoneField;
    
    if (sourceZone === targetZone) return;
    
    if (sourceZone === 'values') {
      this.config.values.splice(index, 1);
    } else if (sourceZone === 'filter') {
      this.config.filters.splice(index, 1);
    } else {
      const sourceArr = sourceZone === 'rows' ? this.config.rows : this.config.columns;
      sourceArr.splice(index, 1);
    }
    
    const dummyField = { key: field, label: field, type: this.fields.find(f => f.key === field)?.type || 'dimension' };
    this.handleFieldDrop(targetZone, dummyField);
  }
  
  renderZones() {
    this.renderZone('rows', this.config.rows, 'rows');
    this.renderZone('columns', this.config.columns, 'columns');
    this.renderValuesZone();
    this.renderFiltersZone();
  }
  
  renderZone(zoneId, items, zoneType) {
    const zone = document.querySelector(`#${zoneId}Zone .zone-content`);
    zone.innerHTML = '';
    
    items.forEach((fieldKey, index) => {
      const field = this.fields.find(f => f.key === fieldKey);
      if (!field) return;
      
      const el = this.createZoneField(field.label, zoneType, {
        field: fieldKey,
        sourceZone: zoneType,
        index
      });
      
      zone.appendChild(el);
    });
  }
  
  renderValuesZone() {
    const zone = document.querySelector('#valuesZone .zone-content');
    zone.innerHTML = '';
    
    this.config.values.forEach((valueConfig, index) => {
      const el = this.createZoneField(valueConfig.label, 'values', {
        field: valueConfig.field,
        sourceZone: 'values',
        index,
        valueConfig
      });
      
      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('remove-btn')) {
          this.showAggregationModal(index);
        }
      });
      
      zone.appendChild(el);
    });
  }
  
  renderFiltersZone() {
    const zone = document.querySelector('#filterZone .zone-content');
    zone.innerHTML = '';
    
    this.config.filters.forEach((filterConfig, index) => {
      const el = this.createZoneField(filterConfig.label, 'filter', {
        field: filterConfig.field,
        sourceZone: 'filter',
        index,
        filterConfig
      });
      
      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('remove-btn')) {
          this.showFilterModal(index);
        }
      });
      
      zone.appendChild(el);
    });
  }
  
  createZoneField(label, zoneType, data) {
    const el = document.createElement('div');
    el.className = `zone-field ${zoneType}`;
    el.draggable = true;
    
    el.innerHTML = `
      <span>${label}</span>
      <button class="remove-btn" title="移除">&times;</button>
    `;
    
    el.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      this.draggedZoneField = data;
      e.dataTransfer.effectAllowed = 'move';
    });
    
    el.addEventListener('dragend', () => {
      this.draggedZoneField = null;
    });
    
    const removeBtn = el.querySelector('.remove-btn');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeZoneField(data);
    });
    
    return el;
  }
  
  removeZoneField(data) {
    const { sourceZone, index } = data;
    
    if (sourceZone === 'values') {
      this.config.values.splice(index, 1);
    } else if (sourceZone === 'filter') {
      this.config.filters.splice(index, 1);
    } else {
      const arr = sourceZone === 'rows' ? this.config.rows : this.config.columns;
      arr.splice(index, 1);
    }
    
    this.renderZones();
    this.renderPivot();
  }
  
  renderPivot() {
    this.renderer.updateConfig(this.config);
  }
  
  setupModal() {
    const modal = document.getElementById('modal');
    const closeBtn = document.getElementById('closeModal');
    
    closeBtn.addEventListener('click', () => {
      this.hideModal();
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.hideModal();
      }
    });
  }
  
  showModal(title, content) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = content;
    document.getElementById('modal').classList.remove('hidden');
  }
  
  hideModal() {
    document.getElementById('modal').classList.add('hidden');
  }
  
  showAggregationModal(valueIndex) {
    const valueConfig = this.config.values[valueIndex];
    const field = this.fields.find(f => f.key === valueConfig.field);
    
    let optionsHtml = '<div class="aggregation-options">';
    
    Object.entries(aggregationTypes).forEach(([key, agg]) => {
      const checked = valueConfig.aggregation === key ? 'checked' : '';
      optionsHtml += `
        <label>
          <input type="radio" name="aggregation" value="${key}" ${checked}>
          <span>${agg.label}</span>
        </label>
      `;
    });
    
    optionsHtml += '</div>';
    optionsHtml += `
      <div class="filter-actions">
        <button class="btn btn-primary" id="saveAggregation">确定</button>
        <button class="btn btn-default" id="cancelAggregation">取消</button>
      </div>
    `;
    
    this.showModal(`设置 ${field.label} 的聚合方式`, optionsHtml);
    
    document.getElementById('saveAggregation').addEventListener('click', () => {
      const selected = document.querySelector('input[name="aggregation"]:checked').value;
      valueConfig.aggregation = selected;
      valueConfig.label = `${aggregationTypes[selected].label}(${field.label})`;
      
      this.renderZones();
      this.renderPivot();
      this.hideModal();
    });
    
    document.getElementById('cancelAggregation').addEventListener('click', () => {
      this.hideModal();
    });
  }
  
  showFilterModal(filterIndex) {
    const filterConfig = this.config.filters[filterIndex];
    const allValues = getDistinctValues(this.rawData, filterConfig.field);
    
    let filterHtml = '<div class="filter-list">';
    
    allValues.forEach(value => {
      const checked = filterConfig.values.includes(value) ? 'checked' : '';
      filterHtml += `
        <label class="filter-item">
          <input type="checkbox" value="${value}" ${checked}>
          <span>${value}</span>
        </label>
      `;
    });
    
    filterHtml += '</div>';
    filterHtml += `
      <div class="filter-actions">
        <button class="btn btn-default" id="selectAllFilter">全选</button>
        <button class="btn btn-default" id="clearAllFilter">清空</button>
        <button class="btn btn-primary" id="saveFilter">确定</button>
        <button class="btn btn-default" id="cancelFilter">取消</button>
      </div>
    `;
    
    this.showModal(`筛选 ${filterConfig.label}`, filterHtml);
    
    document.getElementById('selectAllFilter').addEventListener('click', () => {
      document.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
      });
    });
    
    document.getElementById('clearAllFilter').addEventListener('click', () => {
      document.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
      });
    });
    
    document.getElementById('saveFilter').addEventListener('click', () => {
      const checked = [];
      document.querySelectorAll('.filter-item input[type="checkbox"]:checked').forEach(cb => {
        checked.push(cb.value);
      });
      
      filterConfig.values = checked;
      this.renderZones();
      this.renderPivot();
      this.hideModal();
    });
    
    document.getElementById('cancelFilter').addEventListener('click', () => {
      this.hideModal();
    });
  }
  
  showDetailModal(rowKey, colKey, valueIndex) {
    const rowKeyObj = this.parseKey(rowKey);
    const colKeyObj = this.parseKey(colKey);
    
    const detailConfig = {
      rows: this.config.rows,
      columns: this.config.columns,
      filters: this.config.filters
    };
    
    const records = getDetailRecords(this.rawData, detailConfig, rowKeyObj, colKeyObj);
    
    let title = '明细数据';
    if (rowKeyObj && rowKeyObj.values && rowKeyObj.values.length > 0) {
      title = `明细 - ${rowKeyObj.values.join(' / ')}`;
    }
    
    let tableHtml = `
      <p>共 ${records.length} 条记录</p>
      <table class="detail-table">
        <thead>
          <tr>
    `;
    
    this.fields.forEach(field => {
      tableHtml += `<th>${field.label}</th>`;
    });
    
    tableHtml += `
          </tr>
        </thead>
        <tbody>
    `;
    
    records.slice(0, 100).forEach(record => {
      tableHtml += '<tr>';
      this.fields.forEach(field => {
        let value = record[field.key];
        if (field.key === '利润率') {
          value = (value * 100).toFixed(2) + '%';
        } else if (typeof value === 'number') {
          value = value.toLocaleString();
        }
        tableHtml += `<td>${value}</td>`;
      });
      tableHtml += '</tr>';
    });
    
    tableHtml += '</tbody></table>';
    
    if (records.length > 100) {
      tableHtml += `<p style="margin-top: 10px; color: #999;">显示前 100 条，共 ${records.length} 条</p>`;
    }
    
    this.showModal(title, tableHtml);
  }
  
  parseKey(keyStr) {
    if (!keyStr || keyStr === '__total__' || keyStr === '__grand_total__') {
      return { key: '__total__', values: [], isTotal: true };
    }
    
    const cleanKey = keyStr.replace('__subtotal', '');
    const values = cleanKey.split('||').filter(v => v);
    
    return {
      key: cleanKey,
      values,
      isTotal: false
    };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.pivotApp = new PivotApp();
});
