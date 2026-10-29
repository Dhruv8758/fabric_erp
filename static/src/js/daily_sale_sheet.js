/** @odoo-module **/

import { Component, useState, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { useService } from "@web/core/utils/hooks";

let globalLastSelectedDate = null;

export class DailySaleSheetComponent extends Component {
    static template = "fabric_erp.DailySaleSheetComponent";

    setup() {
        this.action = useService("action");
        this.notification = useService("notification");
        
        const today = new Date().toISOString().split('T')[0];
        const savedWidth = localStorage.getItem('fabric_sheet_width_val') || '100%';
        this.state = useState({
            date: globalLastSelectedDate || today,
            lastBalance: '',
            saveStatus: 'saved', // 'saved' | 'saving' | 'unsaved'
            containerWidthVal: savedWidth, // '100%', '95%', '90%', '80%', '960px'
            products: [],
            customers: [],
            units: [],
            saleLines: [
                { _uid: 'row_init_sale_1', id: 1, customer_name: '', roll_qty: '', qty: '', item_name: '', unit: 'Meter', price: '', total: '', note: '', is_unpaid: false, is_custom_customer: false, is_custom_item: false }
            ],
            cashinLines: [
                { _uid: 'row_init_cashin_1', id: 1, customer_name: '', note: '', money: '', is_khata: false, is_custom_customer: false }
            ],
            cashoutLines: [
                { _uid: 'row_init_cashout_1', id: 1, customer_name: '', note: '', money: '', is_khata: false, is_custom_customer: false }
            ],
            shopexpLines: [
                { _uid: 'row_init_shopexp_1', id: 1, note: '', money: '' }
            ],
            homeexpLines: [
                { _uid: 'row_init_homeexp_1', id: 1, note: '', money: '' }
            ],
            showRollBreakdownModal: false,
            activeRollLine: null,
            tempRollMeters: [],
            quickRollInputStr: "",
        });

        this.autoSaveTimer = null;
        this.isSaving = false;

        this._beforeUnloadHandler = () => {
            if (this.state.saveStatus === 'unsaved') {
                this.saveSheetSilently();
            }
        };

        onWillStart(async () => {
            try {
                const resProducts = await rpc("/fabric_erp/get_products");
                this.state.products = resProducts || [];

                const resCust = await rpc("/fabric_erp/get_customers");
                this.state.customers = resCust || [];

                const resUnits = await rpc("/fabric_erp/get_units");
                this.state.units = resUnits || [];
            } catch (e) {
                console.error("Failed to load inventory/customer/unit items:", e);
            }
            await this.loadSheetByDate(this.state.date);
        });

        onMounted(() => {
            window.addEventListener('beforeunload', this._beforeUnloadHandler);
            
            // Prevent number inputs from changing on scroll or up/down keys
            this._wheelHandler = (e) => {
                if (document.activeElement && document.activeElement.type === 'number') {
                    document.activeElement.blur();
                }
            };
            this._keydownHandler = (e) => {
                if (document.activeElement && document.activeElement.type === 'number') {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                    }
                }
            };
            window.addEventListener('wheel', this._wheelHandler, { passive: false });
            window.addEventListener('keydown', this._keydownHandler);

            const targetSection = window.fabric_target_section || 
                                  (this.props.action && this.props.action.context && this.props.action.context.target_section);
            if (targetSection) {
                setTimeout(() => {
                    const el = document.getElementById(targetSection);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                    window.fabric_target_section = null;
                }, 200);
            }
        });

        onWillUnmount(() => {
            window.removeEventListener('beforeunload', this._beforeUnloadHandler);
            if (this._wheelHandler) window.removeEventListener('wheel', this._wheelHandler);
            if (this._keydownHandler) window.removeEventListener('keydown', this._keydownHandler);
            if (this.autoSaveTimer) {
                clearTimeout(this.autoSaveTimer);
            }
            if (this.state.saveStatus === 'unsaved') {
                this.saveSheetSilently();
            }
        });
    }

    setWidthVal(val) {
        this.state.containerWidthVal = val;
        try {
            localStorage.setItem('fabric_sheet_width_val', val);
        } catch (e) {
            console.error("Failed to save width preference:", e);
        }
    }

    onWidthSliderChange(ev) {
        const val = ev.target.value;
        this.setWidthVal(val + '%');
    }

    async loadSheetByDate(dateStr) {
        try {
            // Refresh customer master list so any newly created customer in Customer Khata is immediately available
            try {
                const resCust = await rpc("/fabric_erp/get_customers");
                if (resCust && resCust.length) {
                    this.state.customers = resCust;
                }
            } catch (e) {
                console.error("Failed to refresh customers", e);
            }

            const data = await rpc("/fabric_erp/get_daily_sheet_by_date", { date_str: dateStr });
            const cleanZero = (val) => (val === 0 || val === '0' || val === 0.0 || !val) ? '' : val;
            if (data && data.exists) {
                this.state.current_uid = data.current_uid;
                this.state.lastBalance = cleanZero(data.last_balance);
                this.state.saleLines = (data.saleLines || []).map(l => ({
                    ...l,
                    _uid: 'row_sale_' + (l.id || (Date.now() + '_' + Math.random().toString(36).substring(2, 9))),
                    roll_qty: cleanZero(l.roll_qty),
                    qty: cleanZero(l.qty),
                    price: cleanZero(l.price),
                    total: cleanZero(l.total),
                    is_custom_customer: false,
                    is_custom_item: false
                }));
                this.state.cashinLines = (data.cashinLines || []).map(l => ({
                    ...l,
                    _uid: 'row_cashin_' + (l.id || (Date.now() + '_' + Math.random().toString(36).substring(2, 9))),
                    money: cleanZero(l.money),
                    is_custom_customer: false
                }));
                this.state.cashoutLines = (data.cashoutLines || []).map(l => ({
                    ...l,
                    _uid: 'row_cashout_' + (l.id || (Date.now() + '_' + Math.random().toString(36).substring(2, 9))),
                    money: cleanZero(l.money),
                    is_custom_customer: false
                }));
                this.state.shopexpLines = (data.shopexpLines || []).map(l => ({
                    ...l,
                    _uid: 'row_shopexp_' + (l.id || (Date.now() + '_' + Math.random().toString(36).substring(2, 9))),
                    money: cleanZero(l.money)
                }));
                this.state.homeexpLines = (data.homeexpLines || []).map(l => ({
                    ...l,
                    _uid: 'row_homeexp_' + (l.id || (Date.now() + '_' + Math.random().toString(36).substring(2, 9))),
                    money: cleanZero(l.money)
                }));
            } else if (data) {
                this.state.lastBalance = cleanZero(data.last_balance);
                this.state.saleLines = [];
                this.state.cashinLines = [];
                this.state.cashoutLines = [];
                this.state.shopexpLines = [];
                this.state.homeexpLines = [];
            }

            // Sync all customer names into state.customers dropdown
            const existingNames = new Set((this.state.customers || []).map(c => (c.name || '').toLowerCase()));
            const mergeCustName = (nameStr) => {
                if (!nameStr) return;
                const trimmed = nameStr.trim();
                if (trimmed && !existingNames.has(trimmed.toLowerCase())) {
                    existingNames.add(trimmed.toLowerCase());
                    this.state.customers.push({ id: Date.now() + Math.random(), name: trimmed });
                }
            };
            for (const line of this.state.saleLines) {
                mergeCustName(line.customer_name);
            }
            for (const line of this.state.cashinLines) {
                mergeCustName(line.customer_name);
            }
            for (const line of this.state.cashoutLines) {
                mergeCustName(line.customer_name);
            }

            // Link loaded unpaid sale lines with matching cashout entries
            for (const saleLine of this.state.saleLines) {
                if (saleLine.is_unpaid) {
                    const custName = (saleLine.customer_name || '').trim();
                    const match = this.state.cashoutLines.find(c => 
                        !c.syncedSaleId && 
                        c.note && 
                        c.note.startsWith('Unpaid Sale:') && 
                        (!custName || c.customer_name === custName || c.note.includes(`Customer: ${custName}`))
                    );
                    if (match) {
                        match.syncedSaleId = saleLine.id;
                    }
                }
            }

        } catch (e) {
            console.error("Failed to load sheet by date", e);
        }
        this.ensureEmptyLines();
    }


    ensureEmptyLines() {
        if (!this.state.saleLines.length) {
            this.addSaleRow();
        } else {
            const last = this.state.saleLines[this.state.saleLines.length - 1];
            if (last && (last.customer_name || last.item_name || last.qty || last.roll_qty || last.price || last.total || last.note || last.roll_meters_str)) {
                this.addSaleRow();
            }
        }

        if (!this.state.cashinLines.length) {
            this.addCashinRow();
        } else {
            const last = this.state.cashinLines[this.state.cashinLines.length - 1];
            if (last && (last.customer_name || last.note || last.money)) {
                this.addCashinRow();
            }
        }

        if (!this.state.cashoutLines.length) {
            this.addCashoutRow();
        } else {
            const last = this.state.cashoutLines[this.state.cashoutLines.length - 1];
            if (last && (last.customer_name || last.note || last.money)) {
                this.addCashoutRow();
            }
        }

        if (!this.state.shopexpLines.length) {
            this.addShopexpRow();
        } else {
            const last = this.state.shopexpLines[this.state.shopexpLines.length - 1];
            if (last && (last.note || last.money)) {
                this.addShopexpRow();
            }
        }

        if (!this.state.homeexpLines.length) {
            this.addHomeexpRow();
        } else {
            const last = this.state.homeexpLines[this.state.homeexpLines.length - 1];
            if (last && (last.note || last.money)) {
                this.addHomeexpRow();
            }
        }
    }

    async prevDate() {
        await this.changeDate(-1);
    }

    async nextDate() {
        await this.changeDate(1);
    }

    async goToToday() {
        const today = new Date().toISOString().split('T')[0];
        if (this.state.date !== today) {
            if (this.state.saveStatus === 'unsaved') {
                await this.saveSheetSilently();
            }
            this.state.date = today;
            globalLastSelectedDate = this.state.date;
            await this.loadSheetByDate(this.state.date);
        }
    }

    async changeDate(offsetDays) {
        if (this.state.saveStatus === 'unsaved') {
            await this.saveSheetSilently();
        }
        const curDateStr = this.state.date || new Date().toISOString().split('T')[0];
        const parts = curDateStr.split('-');
        let dt;
        if (parts.length === 3) {
            const [y, m, d] = parts.map(Number);
            dt = new Date(y, m - 1, d);
        } else {
            dt = new Date();
        }
        dt.setDate(dt.getDate() + offsetDays);
        const year = dt.getFullYear();
        const month = String(dt.getMonth() + 1).padStart(2, '0');
        const day = String(dt.getDate()).padStart(2, '0');
        this.state.date = `${year}-${month}-${day}`;
        globalLastSelectedDate = this.state.date;
        await this.loadSheetByDate(this.state.date);
    }

    async onDateChange(ev) {
        if (this.state.saveStatus === 'unsaved') {
            await this.saveSheetSilently();
        }
        this.state.date = ev.target.value;
        globalLastSelectedDate = this.state.date;
        await this.loadSheetByDate(this.state.date);
    }

    formatVal(val) {
        if (val === '' || val === null || val === undefined) return '0';
        const cleanVal = typeof val === 'string' ? val.replace(/,/g, '') : val;
        const num = parseFloat(cleanVal);
        if (isNaN(num)) return '0';
        const str = num.toFixed(2);
        return str.endsWith('.00') ? str.slice(0, -3) : str;
    }

    getCustomerBalance(nameStr) {
        if (!nameStr) return null;
        let cName = nameStr;
        if (cName.startsWith('Unpaid Sale:') && cName.includes('Customer: ')) {
            const parts = cName.split('Customer: ')[1].split(' |');
            if (parts.length > 0) {
                cName = parts[0].trim();
            }
        }
        const cust = (this.state.customers || []).find(c => c.name === cName);
        if (cust && cust.current_net_balance !== undefined) {
            return this.formatVal(cust.current_net_balance);
        }
        return null;
    }

    getProductStock(nameStr) {
        if (!nameStr) return null;
        const prod = (this.state.products || []).find(p => p.name === nameStr);
        if (prod && prod.quantity !== undefined) {
            return this.formatVal(prod.quantity);
        }
        return null;
    }

    // Dynamic Calculations
    get totalSale() {
        return this.state.saleLines.reduce((sum, line) => sum + (parseFloat(line.total) || 0), 0);
    }

    get totalSaleRollQty() {
        return this.state.saleLines.reduce((sum, line) => sum + (parseFloat(line.roll_qty) || 0), 0);
    }

    get totalSaleMeterQty() {
        return this.state.saleLines.reduce((sum, line) => sum + (parseFloat(line.qty) || 0), 0);
    }

    get totalCashin() {
        return this.state.cashinLines.reduce((sum, line) => sum + (parseFloat(line.money) || 0), 0);
    }

    get totalCashout() {
        return this.state.cashoutLines.reduce((sum, line) => sum + (parseFloat(line.money) || 0), 0);
    }

    get totalShopexp() {
        return this.state.shopexpLines.reduce((sum, line) => sum + (parseFloat(line.money) || 0), 0);
    }

    get totalHomeexp() {
        return this.state.homeexpLines.reduce((sum, line) => sum + (parseFloat(line.money) || 0), 0);
    }

    get subTotal() {
        return (parseFloat(this.state.lastBalance) || 0) + this.totalSale + this.totalCashin;
    }

    get currentDayBalance() {
        return this.subTotal - this.totalCashout - this.totalShopexp - this.totalHomeexp;
    }

    get validSaleLines() {
        return this.state.saleLines.filter(l => 
            (l.customer_name && l.customer_name.trim()) || 
            (l.item_name && l.item_name.trim()) || 
            (parseFloat(l.qty) > 0) || 
            (parseFloat(l.total) > 0) ||
            (parseFloat(l.roll_qty) > 0)
        );
    }

    get validCashinLines() {
        return this.state.cashinLines.filter(l => 
            (l.customer_name && l.customer_name.trim()) || 
            (parseFloat(l.money) > 0) || 
            (l.note && l.note.trim())
        );
    }

    get validCashoutLines() {
        return this.state.cashoutLines.filter(l => 
            (l.customer_name && l.customer_name.trim()) || 
            (parseFloat(l.money) > 0) || 
            (l.note && l.note.trim())
        );
    }

    get validShopexpLines() {
        return this.state.shopexpLines.filter(l => 
            (parseFloat(l.money) > 0) || 
            (l.note && l.note.trim())
        );
    }

    get validHomeexpLines() {
        return this.state.homeexpLines.filter(l => 
            (parseFloat(l.money) > 0) || 
            (l.note && l.note.trim())
        );
    }

    // Auto-Add Empty Line Logic
    checkAndAutoAddSaleRow() {
        const lines = this.state.saleLines;
        const lastLine = lines[lines.length - 1];
        if (lastLine && (lastLine.customer_name || lastLine.item_name || lastLine.qty || lastLine.roll_qty || lastLine.price || lastLine.total || lastLine.note || lastLine.roll_meters_str)) {
            this.addSaleRow();
        }
    }

    onCustomerInput(line) {
        if (line.is_unpaid) {
            this.syncUnpaidCashoutEntry(line);
        }
        this.checkAndAutoAddSaleRow();
        this.triggerAutoSave();
    }

    onCustomerChange(line) {
        const val = (line.customer_name || '').trim();
        if (val) {
            const match = this.state.customers.find(c => (c.name || '').toLowerCase() === val.toLowerCase());
            if (match) {
                line.customer_name = match.name;
                line.is_custom_customer = false;
            } else if (!this.state.customers.some(c => (c.name || '').toLowerCase() === val.toLowerCase())) {
                this.state.customers.push({ id: Date.now() + Math.random(), name: val });
            }
        }
    }

    onSaleLineChange(line) {
        if (line.is_unpaid) {
            this.syncUnpaidCashoutEntry(line);
        }
        this.checkAndAutoAddSaleRow();
        this.triggerAutoSave();
    }

    toggleUnpaidSale(line) {
        this.syncUnpaidCashoutEntry(line);
        this.triggerAutoSave();
    }

    onToggleKhata(line) {
        this.triggerAutoSave();
    }

    syncUnpaidCashoutEntry(line) {
        if (!line) return;
        const custName = line.customer_name ? line.customer_name.trim() : '';
        const itemName = line.item_name ? line.item_name.trim() : '';
        const rollQty = parseFloat(line.roll_qty) || 0;
        const qty = parseFloat(line.qty) || 0;
        const unit = line.unit || 'Meter';
        const price = parseFloat(line.price) || 0;
        const totalMoney = parseFloat(line.total) || 0;
        const note = line.note ? line.note.trim() : '';

        const parts = [];
        if (custName) parts.push(`Customer: ${custName}`);
        if (itemName) parts.push(`Item: ${itemName}`);
        
        const qtyParts = [];
        if (rollQty > 0) qtyParts.push(`${rollQty} Roll${rollQty > 1 ? 's' : ''}`);
        if (qty > 0) qtyParts.push(`${qty} ${unit}${qty > 1 ? 's' : ''}`);
        if (line.roll_meters_str) qtyParts.push(`(${line.roll_meters_str})`);
        
        if (qtyParts.length > 0) parts.push(`Qty: ${qtyParts.join(' / ')}`);
        if (price > 0) parts.push(`Rate: ${price}/${unit}`);
        if (note) parts.push(`Note: ${note}`);

        const detailText = parts.length > 0 ? parts.join(' | ') : (custName || 'Unpaid Sale');
        const noteText = `Unpaid Sale: ${detailText}`;

        let existingIdx = this.state.cashoutLines.findIndex(c => c.syncedSaleId === line.id);
        if (existingIdx === -1 && custName) {
            existingIdx = this.state.cashoutLines.findIndex(c => 
                !c.syncedSaleId && 
                c.note && 
                c.note.startsWith('Unpaid Sale:') && 
                (c.customer_name === custName || c.note.includes(`Customer: ${custName}`)) &&
                c.money === totalMoney
            );
        }

        if (line.is_unpaid) {
            if (existingIdx !== -1) {
                this.state.cashoutLines[existingIdx].syncedSaleId = line.id;
                this.state.cashoutLines[existingIdx].customer_name = custName;
                this.state.cashoutLines[existingIdx].note = noteText;
                this.state.cashoutLines[existingIdx].money = totalMoney;
                this.state.cashoutLines[existingIdx].is_custom_customer = false;
                // Preserve the existing is_khata value instead of forcing it to true
            } else {
                const newCashout = {
                    _uid: 'row_cashout_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
                    id: Date.now() + Math.random(),
                    syncedSaleId: line.id,
                    customer_name: custName,
                    note: noteText,
                    money: totalMoney,
                    is_custom_customer: false,
                    is_khata: false
                };
                const emptyIdx = this.state.cashoutLines.findIndex(c => !c.note && (!c.money || c.money === 0));
                if (emptyIdx !== -1) {
                    this.state.cashoutLines.splice(emptyIdx, 1, newCashout);
                } else {
                    this.state.cashoutLines.push(newCashout);
                }
            }
        } else {
            // Strictly match only the syncedSaleId to prevent accidentally deleting other unpaid entries for the same customer
            let idx = this.state.cashoutLines.findIndex(c => c.syncedSaleId === line.id);
            if (idx !== -1) {
                this.state.cashoutLines.splice(idx, 1);
            }
        }
        this.ensureEmptyLines();
    }

    checkAndAutoAddCashinRow() {
        const lines = this.state.cashinLines;
        const lastLine = lines[lines.length - 1];
        if (lastLine && (lastLine.customer_name || lastLine.note || lastLine.money)) {
            this.addCashinRow();
        }
    }

    checkAndAutoAddCashoutRow() {
        const lines = this.state.cashoutLines;
        const lastLine = lines[lines.length - 1];
        if (lastLine && (lastLine.customer_name || lastLine.note || lastLine.money)) {
            this.addCashoutRow();
        }
    }

    checkAndAutoAddShopexpRow() {
        const lines = this.state.shopexpLines;
        const lastLine = lines[lines.length - 1];
        if (lastLine && (lastLine.note || lastLine.money)) {
            this.addShopexpRow();
        }
    }

    checkAndAutoAddHomeexpRow() {
        const lines = this.state.homeexpLines;
        const lastLine = lines[lines.length - 1];
        if (lastLine && (lastLine.note || lastLine.money)) {
            this.addHomeexpRow();
        }
    }



    // Inventory Item Selection Handler
    onSelectItemName(line, ev) {
        const val = ev ? ev.target.value : line.item_name;
        line.item_name = val;
        if (val) {
            const trimmed = val.trim();
            const match = this.state.products.find(i => (i.name || '').toLowerCase() === trimmed.toLowerCase());
            if (match) {
                if (match.unit) {
                    line.unit = match.unit;
                }
                if (match.price_per_unit) {
                    line.price = match.price_per_unit;
                }
            }
        }
        this.updateSaleRow(line);
    }

    onItemChange(line, ev) {
        const val = (ev ? ev.target.value : line.item_name || '').trim();
        if (val && !this.state.products.some(i => (i.name || '').toLowerCase() === val.toLowerCase())) {
            this.state.products.push({ id: Date.now() + Math.random(), name: val });
        }
    }

    // Roll Breakdown Modal Logic
    openRollBreakdownModal(line) {
        this.state.activeRollLine = line;
        const count = Math.max(1, Math.floor(parseFloat(line.roll_qty) || 1));
        let arr = [];
        if (line.roll_meters_str) {
            const parts = line.roll_meters_str.split(/[+,\s]+/).map(p => parseFloat(p)).filter(n => !isNaN(n) && n > 0);
            if (parts.length) {
                arr = parts;
            }
        }
        while (arr.length < count) {
            arr.push('');
        }
        this.state.tempRollMeters = arr;
        this.state.quickRollInputStr = arr.filter(n => n > 0).join(" + ");
        this.state.showRollBreakdownModal = true;
    }

    onQuickRollInput(val) {
        this.state.quickRollInputStr = val;
        const parts = val.split(/[+,\s]+/).map(p => parseFloat(p)).filter(n => !isNaN(n) && n > 0);
        if (parts.length) {
            this.state.tempRollMeters = parts;
        }
    }

    updateTempRollMeter(idx, val) {
        const num = parseFloat(val);
        this.state.tempRollMeters[idx] = isNaN(num) ? '' : num;
        this.state.quickRollInputStr = this.state.tempRollMeters.filter(n => parseFloat(n) > 0).join(" + ");
    }

    get tempRollTotalMeters() {
        const sum = (this.state.tempRollMeters || []).reduce((acc, m) => acc + (parseFloat(m) || 0), 0);
        return this.formatVal(sum);
    }

    addRollToBreakdown() {
        this.state.tempRollMeters.push('');
    }

    removeRollFromBreakdown(idx) {
        if (this.state.tempRollMeters.length > 1) {
            this.state.tempRollMeters.splice(idx, 1);
            this.state.quickRollInputStr = this.state.tempRollMeters.filter(n => n > 0).join(" + ");
        }
    }

    applyRollBreakdown() {
        if (this.state.activeRollLine) {
            const sum = (this.state.tempRollMeters || []).reduce((acc, m) => acc + (parseFloat(m) || 0), 0);
            const validMeters = this.state.tempRollMeters.filter(m => parseFloat(m) > 0);
            this.state.activeRollLine.qty = parseFloat(sum.toFixed(2));
            this.state.activeRollLine.roll_qty = validMeters.length || this.state.tempRollMeters.length;
            this.state.activeRollLine.roll_meters_str = validMeters.map(m => parseFloat(m)).join(" + ");
            this.updateSaleRow(this.state.activeRollLine);
        }
        this.closeRollBreakdownModal();
    }

    closeRollBreakdownModal() {
        this.state.showRollBreakdownModal = false;
        this.state.activeRollLine = null;
        this.state.tempRollMeters = [];
        this.state.quickRollInputStr = "";
    }

    clearAllSheet() {
        if (confirm("Are you sure you want to delete ALL entries of the whole daily sales sheet for this date?")) {
            this.state.saleLines = [];
            this.state.cashinLines = [];
            this.state.cashoutLines = [];
            this.state.shopexpLines = [];
            this.state.homeexpLines = [];
            this.ensureEmptyLines();
            this.triggerAutoSave();
        }
    }

    clearSaleTable() {
        if (confirm("Are you sure you want to delete all Sale entries?")) {
            this.state.saleLines = [];
            this.ensureEmptyLines();
            this.triggerAutoSave();
        }
    }

    clearCashinTable() {
        if (confirm("Are you sure you want to delete all Cash In entries?")) {
            this.state.cashinLines = [];
            this.ensureEmptyLines();
            this.triggerAutoSave();
        }
    }

    clearCashoutTable() {
        if (confirm("Are you sure you want to delete all Cash Out entries?")) {
            this.state.cashoutLines = [];
            this.ensureEmptyLines();
            this.triggerAutoSave();
        }
    }

    clearShopexpTable() {
        if (confirm("Are you sure you want to delete all Shop Expense entries?")) {
            this.state.shopexpLines = [];
            this.ensureEmptyLines();
            this.triggerAutoSave();
        }
    }

    clearHomeexpTable() {
        if (confirm("Are you sure you want to delete all Home Expense entries?")) {
            this.state.homeexpLines = [];
            this.ensureEmptyLines();
            this.triggerAutoSave();
        }
    }

    // Row Operations
    addSaleRow() {
        this.state.saleLines.push({
            _uid: 'row_sale_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            id: Date.now() + Math.random(),
            customer_name: '',
            roll_qty: '',
            qty: '',
            item_name: '',
            unit: 'Meter',
            price: '',
            total: '',
            note: '',
            roll_meters_str: '',
            is_unpaid: false,
            is_custom_customer: false,
            is_custom_item: false
        });
    }

    async removeSaleRow(idx) {
        const line = this.state.saleLines[idx];
        if (!line) return;

        const qty = parseFloat(line.qty) || 0;
        const itemName = (line.item_name || '').trim();
        const unit = line.unit || 'Meter';

        // Remove row from state immediately
        const removed = this.state.saleLines.splice(idx, 1)[0];
        this.ensureEmptyLines();

        if (removed && removed.id) {
            const cIdx = this.state.cashoutLines.findIndex(c => c.syncedSaleId === removed.id);
            if (cIdx !== -1) {
                this.state.cashoutLines.splice(cIdx, 1);
                this.ensureEmptyLines();
            }
        }

        // Instantly increase stock for this product in frontend state so UI updates immediately
        if (itemName && qty > 0) {
            const prod = (this.state.products || []).find(p => (p.name || '').toLowerCase() === itemName.toLowerCase());
            if (prod && prod.quantity !== undefined) {
                prod.quantity = (parseFloat(prod.quantity) || 0) + qty;
            }
        }

        // Call backend to delete sale line and increase stock in database
        const isDbId = removed && removed.id && typeof removed.id === 'number' && Number.isInteger(removed.id);
        if (isDbId) {
            try {
                const res = await rpc("/fabric_erp/delete_sale_line", {
                    line_id: removed.id,
                    increase_stock: true,
                });
                if (res && res.products) {
                    this.state.products = res.products;
                }
                if (this.notification && itemName && qty > 0) {
                    this.notification.add(`Deleted row. Stock for "${itemName}" increased by +${qty} ${unit} in inventory.`, { type: "success" });
                }
            } catch (e) {
                console.error("Error deleting sale line via RPC:", e);
                this.triggerAutoSave();
            }
        } else {
            if (this.notification && itemName && qty > 0) {
                this.notification.add(`Deleted row for "${itemName}".`, { type: "info" });
            }
        }

        this.triggerAutoSave();
    }

    updateSaleRow(line) {
        const q = parseFloat(line.qty);
        const p = parseFloat(line.price);
        if (!isNaN(q) && !isNaN(p) && q > 0 && p > 0) {
            line.total = this.formatVal(q * p);
        } else {
            line.total = '';
        }
        if (line.is_unpaid) {
            this.syncUnpaidCashoutEntry(line);
        }
        this.checkAndAutoAddSaleRow();
        this.triggerAutoSave();
    }

    addCashinRow() {
        this.state.cashinLines.push({
            _uid: 'row_cashin_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            id: Date.now() + Math.random(),
            customer_name: '',
            note: '',
            money: '',
            is_khata: false,
            is_custom_customer: false
        });
    }

    removeCashinRow(idx) {
        if (this.state.cashinLines.length > 1) {
            this.state.cashinLines.splice(idx, 1);
            this.triggerAutoSave();
        }
    }

    onCashinInput(line) {
        this.checkAndAutoAddCashinRow();
        this.triggerAutoSave();
    }

    onCashinChange(line) {
        const val = (line.customer_name || '').trim();
        if (val) {
            const match = this.state.customers.find(c => (c.name || '').toLowerCase() === val.toLowerCase());
            if (match) {
                line.customer_name = match.name;
                line.is_custom_customer = false;
            } else if (!this.state.customers.some(c => (c.name || '').toLowerCase() === val.toLowerCase())) {
                this.state.customers.push({ id: Date.now() + Math.random(), name: val });
            }
        }
    }

    addCashoutRow() {
        this.state.cashoutLines.push({
            _uid: 'row_cashout_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            id: Date.now() + Math.random(),
            customer_name: '',
            note: '',
            money: '',
            is_khata: false,
            is_custom_customer: false
        });
    }

    removeCashoutRow(idx) {
        if (this.state.cashoutLines.length > 1) {
            this.state.cashoutLines.splice(idx, 1);
            this.triggerAutoSave();
        }
    }

    onCashoutInput(line) {
        this.checkAndAutoAddCashoutRow();
        this.triggerAutoSave();
    }

    onCashoutChange(line) {
        const val = (line.customer_name || '').trim();
        if (val) {
            const match = this.state.customers.find(c => (c.name || '').toLowerCase() === val.toLowerCase());
            if (match) {
                line.customer_name = match.name;
                line.is_custom_customer = false;
            } else if (!this.state.customers.some(c => (c.name || '').toLowerCase() === val.toLowerCase())) {
                this.state.customers.push({ id: Date.now() + Math.random(), name: val });
            }
        }
    }

    addShopexpRow() {
        this.state.shopexpLines.push({
            _uid: 'row_shopexp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            id: Date.now() + Math.random(),
            note: '',
            money: ''
        });
    }

    removeShopexpRow(idx) {
        if (this.state.shopexpLines.length > 1) {
            this.state.shopexpLines.splice(idx, 1);
            this.triggerAutoSave();
        }
    }

    onShopexpInput(line) {
        this.checkAndAutoAddShopexpRow();
        this.triggerAutoSave();
    }

    addHomeexpRow() {
        this.state.homeexpLines.push({
            _uid: 'row_homeexp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            id: Date.now() + Math.random(),
            note: '',
            money: ''
        });
    }

    removeHomeexpRow(idx) {
        if (this.state.homeexpLines.length > 1) {
            this.state.homeexpLines.splice(idx, 1);
            this.triggerAutoSave();
        }
    }

    onHomeexpInput(line) {
        this.checkAndAutoAddHomeexpRow();
        this.triggerAutoSave();
    }

    onCustomerSelectChange(line, ev) {
        const val = ev ? ev.target.value : '';
        if (val === '__new__') {
            line.is_custom_customer = true;
            line.customer_name = '';
        } else {
            line.is_custom_customer = false;
            line.customer_name = val;
            this.onCustomerInput(line);
        }
    }

    cancelCustomCustomer(line) {
        line.is_custom_customer = false;
        line.customer_name = '';
    }

    _clearCustomModeForCustomer(name) {
        if (!name) return;
        const lower = name.trim().toLowerCase();
        for (const l of this.state.saleLines) {
            if ((l.customer_name || '').trim().toLowerCase() === lower) {
                l.customer_name = name;
                l.is_custom_customer = false;
            }
        }
        for (const l of this.state.cashinLines) {
            if ((l.customer_name || '').trim().toLowerCase() === lower) {
                l.customer_name = name;
                l.is_custom_customer = false;
            }
        }
        for (const l of this.state.cashoutLines) {
            if ((l.customer_name || '').trim().toLowerCase() === lower) {
                l.customer_name = name;
                l.is_custom_customer = false;
            }
        }
    }

    async saveCustomCustomer(line) {
        const val = (line.customer_name || '').trim();
        if (!val) {
            this.cancelCustomCustomer(line);
            return;
        }
        try {
            const res = await rpc("/fabric_erp/create_customer", { name: val });
            if (res && res.status === 'success') {
                const existing = this.state.customers.find(c => (c.name || '').toLowerCase() === res.name.toLowerCase());
                if (!existing) {
                    this.state.customers.push({ id: res.id, name: res.name });
                } else {
                    existing.id = res.id;
                    existing.name = res.name;
                }
                line.customer_name = res.name;
                line.is_custom_customer = false;
                this._clearCustomModeForCustomer(res.name);
                this.onCustomerInput(line);
                if (this.notification) {
                    this.notification.add("Customer Created: " + res.name, { type: "success" });
                }
            } else {
                alert("Failed to create customer.");
            }
        } catch (e) {
            console.error("Failed to create customer", e);
            alert("Error creating customer");
        }
    }

    onCashinSelectChange(line, ev) {
        const val = ev ? ev.target.value : '';
        if (val === '__new__') {
            line.is_custom_customer = true;
            line.customer_name = '';
        } else {
            line.is_custom_customer = false;
            line.customer_name = val;
            this.onCashinInput(line);
        }
    }

    cancelCustomCashin(line) {
        line.is_custom_customer = false;
        line.customer_name = '';
    }

    async saveCustomCashinCustomer(line) {
        const val = (line.customer_name || '').trim();
        if (!val) {
            this.cancelCustomCashin(line);
            return;
        }
        try {
            const res = await rpc("/fabric_erp/create_customer", { name: val });
            if (res && res.status === 'success') {
                const existing = this.state.customers.find(c => (c.name || '').toLowerCase() === res.name.toLowerCase());
                if (!existing) {
                    this.state.customers.push({ id: res.id, name: res.name });
                } else {
                    existing.id = res.id;
                    existing.name = res.name;
                }
                line.customer_name = res.name;
                line.is_custom_customer = false;
                this._clearCustomModeForCustomer(res.name);
                this.onCashinInput(line);
                if (this.notification) {
                    this.notification.add("Customer Created: " + res.name, { type: "success" });
                }
            } else {
                alert("Failed to create customer.");
            }
        } catch (e) {
            console.error("Failed to create customer", e);
            alert("Error creating customer");
        }
    }

    onCashoutSelectChange(line, ev) {
        const val = ev ? ev.target.value : '';
        if (val === '__new__') {
            line.is_custom_customer = true;
            line.customer_name = '';
        } else {
            line.is_custom_customer = false;
            line.customer_name = val;
            this.onCashoutInput(line);
        }
    }

    cancelCustomCashout(line) {
        line.is_custom_customer = false;
        line.customer_name = '';
    }

    async saveCustomCashoutCustomer(line) {
        const val = (line.customer_name || '').trim();
        if (!val) {
            this.cancelCustomCashout(line);
            return;
        }
        try {
            const res = await rpc("/fabric_erp/create_customer", { name: val });
            if (res && res.status === 'success') {
                const existing = this.state.customers.find(c => (c.name || '').toLowerCase() === res.name.toLowerCase());
                if (!existing) {
                    this.state.customers.push({ id: res.id, name: res.name });
                } else {
                    existing.id = res.id;
                    existing.name = res.name;
                }
                line.customer_name = res.name;
                line.is_custom_customer = false;
                this._clearCustomModeForCustomer(res.name);
                this.onCashoutInput(line);
                if (this.notification) {
                    this.notification.add("Customer Created: " + res.name, { type: "success" });
                }
            } else {
                alert("Failed to create customer.");
            }
        } catch (e) {
            console.error("Failed to create customer", e);
            alert("Error creating customer");
        }
    }



    onItemSelectChange(line, ev) {
        const val = ev ? ev.target.value : '';
        if (val === '__new__') {
            line.is_custom_item = true;
            line.item_name = '';
        } else {
            line.is_custom_item = false;
            line.item_name = val;
            this.onSelectItemName(line, ev);
        }
    }

    cancelCustomItem(line) {
        line.is_custom_item = false;
        line.item_name = '';
    }

    async saveCustomItem(line) {
        const val = (line.item_name || '').trim();
        if (!val) {
            this.cancelCustomItem(line);
            return;
        }
        try {
            const res = await rpc("/fabric_erp/create_product", { name: val, unit: line.unit || 'Meter', price: parseFloat(line.price) || 0.0 });
            if (res && res.status === 'success') {
                const existing = this.state.products.find(i => (i.name || '').toLowerCase() === res.name.toLowerCase());
                if (!existing) {
                    this.state.products.push({ id: res.id, name: res.name, unit: res.unit, price_per_unit: res.price_per_unit, quantity: 0 });
                } else {
                    existing.id = res.id;
                    existing.name = res.name;
                }
                line.item_name = res.name;
                if (res.unit) {
                    line.unit = res.unit;
                }
                if (res.price_per_unit) {
                    line.price = res.price_per_unit;
                }
                line.is_custom_item = false;
                this.updateSaleRow(line);
                if (this.notification) {
                    this.notification.add("Product Created: " + res.name, { type: "success" });
                }
            } else {
                alert("Failed to create product.");
            }
        } catch (e) {
            console.error("Failed to create product", e);
            alert("Error creating product");
        }
    }

    onSelectCustomerDropdown(line, ev) {
        const val = ev ? ev.target.value : '';
        if (val) {
            line.customer_name = val;
            this.onCustomerInput(line);
            ev.target.value = '';
        }
    }



    triggerAutoSave() {
        this.state.saveStatus = 'unsaved';
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.autoSaveTimer = setTimeout(() => {
            // If the user currently has an active dropdown open or focused, don't interrupt them: re-queue autosave
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'SELECT' || activeEl.classList.contains('form-select'))) {
                this.triggerAutoSave();
                return;
            }
            this.saveSheetSilently();
        }, 2500);
    }

    async saveSheetSilently() {
        if (this.isSaving) return;
        this.isSaving = true;
        this.state.saveStatus = 'saving';
        try {
            const res = await rpc("/fabric_erp/save_daily_sheet", {
                date_str: this.state.date,
                last_balance: this.state.lastBalance,
                sale_lines: this.state.saleLines,
                cashin_lines: this.state.cashinLines,
                cashout_lines: this.state.cashoutLines,
                shopexp_lines: this.state.shopexpLines,
                homeexp_lines: this.state.homeexpLines,
                is_silent: true,
            });
            if (res && res.sale_lines_data) {
                res.sale_lines_data.forEach((sData, idx) => {
                    if (this.state.saleLines[idx] && sData.id) {
                        this.state.saleLines[idx].id = sData.id;
                    }
                });
            }
            // Merge newly added customers from backend if any
            if (res && res.customers && res.customers.length) {
                const existingCIds = new Set((this.state.customers || []).map(c => c.id));
                for (const c of res.customers) {
                    if (!existingCIds.has(c.id)) {
                        this.state.customers.push(c);
                        existingCIds.add(c.id);
                    }
                }
            }
            // Append newly added products from backend if any without re-creating existing option nodes
            if (res && res.products && res.products.length > (this.state.products || []).length) {
                const existingPIds = new Set((this.state.products || []).map(p => p.id));
                for (const p of res.products) {
                    if (!existingPIds.has(p.id)) {
                        this.state.products.push(p);
                        existingPIds.add(p.id);
                    }
                }
            }
            // Once saved, ensure no line with customer_name is stuck in custom mode with the right (✓) button
            this.state.saleLines.forEach(l => { if (l.customer_name) l.is_custom_customer = false; });
            this.state.cashinLines.forEach(l => { if (l.customer_name) l.is_custom_customer = false; });
            this.state.cashoutLines.forEach(l => { if (l.customer_name) l.is_custom_customer = false; });

            this.state.saveStatus = 'saved';
        } catch (e) {
            console.error("Auto-save failed", e);
            this.state.saveStatus = 'unsaved';
            const errMsg = (e && e.data && e.data.message) || (e && e.message) || '';
            if (errMsg.includes("Security Restriction") && this.notification) {
                this.notification.add(errMsg, { type: "danger" });
            }
        } finally {
            this.isSaving = false;
        }
    }

    generateCleanReportHtml() {
        const dateStr = this.state.date || '';
        const lastBalStr = this.formatVal(this.state.lastBalance) || '0.00';
        
        // Filter valid sale lines
        const validSales = (this.state.saleLines || []).filter(l => 
            (l.customer_name && String(l.customer_name).trim() !== '') || 
            (l.item_name && String(l.item_name).trim() !== '') || 
            (parseFloat(l.qty) > 0) || 
            (parseFloat(l.total) > 0) || 
            (parseFloat(l.roll_qty) > 0)
        );

        let saleRowsHtml = '';
        if (validSales.length > 0) {
            validSales.forEach((line, idx) => {
                const unpaidBadge = line.is_unpaid ? '<span style="display:inline-block; background:#ffedd5; color:#c2410c; border:1px solid #fed7aa; border-radius:3px; padding:1px 4px; font-weight:700; font-size:8.5px; margin-left:4px;">UNPAID</span>' : '';
                const rollBreakdown = line.roll_meters_str ? `<div style="font-size:8.5px; color:#475569; font-weight:normal; margin-top:1px;">(${line.roll_meters_str} m)</div>` : '';
                saleRowsHtml += `
                    <tr style="page-break-inside:avoid; border-bottom:1px solid #cbd5e1;">
                        <td style="border:1px solid #cbd5e1; padding:6px 4px; text-align:center;">${idx + 1}</td>
                        <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:left; font-weight:600; color:#0f172a;">${line.customer_name || '-'}</td>
                        <td style="border:1px solid #cbd5e1; padding:6px 4px; text-align:center;">${line.roll_qty || '-'}</td>
                        <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:left; font-weight:500;">${line.item_name || '-'}</td>
                        <td style="border:1px solid #cbd5e1; padding:6px 4px; text-align:right; font-weight:600;">${line.qty || '0'}${rollBreakdown}</td>
                        <td style="border:1px solid #cbd5e1; padding:6px 4px; text-align:center; color:#475569;">${line.unit || 'Meter'}</td>
                        <td style="border:1px solid #cbd5e1; padding:6px 4px; text-align:right;">${line.price || '0'}</td>
                        <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:right; font-weight:700; color:#166534;">${line.total || '0'}</td>
                        <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:left; font-size:10px; color:#334155;">${line.note || ''}${unpaidBadge}</td>
                    </tr>
                `;
            });
        } else {
            saleRowsHtml = `
                <tr>
                    <td colspan="9" style="border:1px solid #cbd5e1; padding:12px; text-align:center; color:#64748b; font-style:italic;">No sales entries recorded for this date.</td>
                </tr>
            `;
        }

        // Cash In
        const validCashin = (this.state.cashinLines || []).filter(l => 
            (l.customer_name && String(l.customer_name).trim() !== '') || 
            (parseFloat(l.money) > 0) || 
            (l.note && String(l.note).trim() !== '')
        );
        let cashinSection = '';
        if (validCashin.length > 0) {
            let cashinRows = '';
            validCashin.forEach((l, idx) => {
                cashinRows += `
                    <tr style="page-break-inside:avoid; border-bottom:1px solid #cbd5e1;">
                        <td style="border:1px solid #cbd5e1; padding:5px 4px; text-align:center;">${idx + 1}</td>
                        <td style="border:1px solid #cbd5e1; padding:5px 8px; text-align:left; font-weight:600;">${l.customer_name || '-'}</td>
                        <td style="border:1px solid #cbd5e1; padding:5px 8px; text-align:left; color:#334155;">${l.note || '-'}</td>
                        <td style="border:1px solid #cbd5e1; padding:5px 8px; text-align:right; font-weight:700; color:#166534;">${l.money || '0'}</td>
                    </tr>
                `;
            });
            cashinSection = `
                <div style="margin-bottom:14px; page-break-inside:auto;">
                    <div style="font-size:13px; font-weight:700; color:#166534; padding-bottom:4px; margin-bottom:6px; border-bottom:1.5px solid #166534;">
                        ⬇ CASH IN
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:10.5px;">
                        <thead>
                            <tr style="background-color:#166534; color:#ffffff;">
                                <th style="border:1px solid #14532d; padding:5px 4px; text-align:center; width:5%;">#</th>
                                <th style="border:1px solid #14532d; padding:5px 8px; text-align:left; width:35%;">Customer</th>
                                <th style="border:1px solid #14532d; padding:5px 8px; text-align:left; width:35%;">Note</th>
                                <th style="border:1px solid #14532d; padding:5px 8px; text-align:right; width:25%;">Money</th>
                            </tr>
                        </thead>
                        <tbody>${cashinRows}</tbody>
                        <tfoot>
                            <tr style="background:#f0fdf4; font-weight:700;">
                                <td colspan="3" style="border:1px solid #86efac; padding:6px 8px; text-align:right;">Total Cash In</td>
                                <td style="border:1px solid #86efac; padding:6px 8px; text-align:right; font-size:11.5px; color:#166534;">${this.formatVal(this.totalCashin)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        }

        // Cash Out
        const validCashout = (this.state.cashoutLines || []).filter(l => 
            (l.customer_name && String(l.customer_name).trim() !== '') || 
            (parseFloat(l.money) > 0) || 
            (l.note && String(l.note).trim() !== '')
        );
        let cashoutSection = '';
        if (validCashout.length > 0) {
            let cashoutRows = '';
            validCashout.forEach((l, idx) => {
                cashoutRows += `
                    <tr style="page-break-inside:avoid; border-bottom:1px solid #cbd5e1;">
                        <td style="border:1px solid #cbd5e1; padding:5px 4px; text-align:center;">${idx + 1}</td>
                        <td style="border:1px solid #cbd5e1; padding:5px 8px; text-align:left; font-weight:600;">${l.customer_name || '-'}</td>
                        <td style="border:1px solid #cbd5e1; padding:5px 8px; text-align:left; color:#334155;">${l.note || '-'}</td>
                        <td style="border:1px solid #cbd5e1; padding:5px 8px; text-align:right; font-weight:700; color:#991b1b;">${this.formatVal(l.money)}</td>
                    </tr>
                `;
            });
            cashoutSection = `
                <div style="margin-bottom:14px; page-break-inside:auto;">
                    <div style="font-size:13px; font-weight:700; color:#991b1b; padding-bottom:4px; margin-bottom:6px; border-bottom:1.5px solid #991b1b;">
                        ⬆ CASH OUT
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:10.5px;">
                        <thead>
                            <tr style="background-color:#991b1b; color:#ffffff;">
                                <th style="border:1px solid #7f1d1d; padding:5px 4px; text-align:center; width:5%;">#</th>
                                <th style="border:1px solid #7f1d1d; padding:5px 8px; text-align:left; width:35%;">Customer</th>
                                <th style="border:1px solid #7f1d1d; padding:5px 8px; text-align:left; width:35%;">Note</th>
                                <th style="border:1px solid #7f1d1d; padding:5px 8px; text-align:right; width:25%;">Money</th>
                            </tr>
                        </thead>
                        <tbody>${cashoutRows}</tbody>
                        <tfoot>
                            <tr style="background:#fef2f2; font-weight:700;">
                                <td colspan="3" style="border:1px solid #fca5a5; padding:6px 8px; text-align:right;">Total Cash Out</td>
                                <td style="border:1px solid #fca5a5; padding:6px 8px; text-align:right; font-size:11.5px; color:#991b1b;">${this.formatVal(this.totalCashout)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        }

        // Expenses
        const validShopexp = (this.state.shopexpLines || []).filter(l => (parseFloat(l.money) > 0) || (l.note && String(l.note).trim() !== ''));
        const validHomeexp = (this.state.homeexpLines || []).filter(l => (parseFloat(l.money) > 0) || (l.note && String(l.note).trim() !== ''));
        let expensesSection = '';
        if (validShopexp.length > 0 || validHomeexp.length > 0) {
            let shopHtml = '';
            if (validShopexp.length > 0) {
                let sRows = '';
                validShopexp.forEach((l, idx) => {
                    sRows += `
                        <tr style="border-bottom:1px solid #e2e8f0;">
                            <td style="padding:4px; text-align:center;">${idx + 1}</td>
                            <td style="padding:4px 6px; text-align:left;">${l.note || '-'}</td>
                            <td style="padding:4px 6px; text-align:right; font-weight:600;">${this.formatVal(l.money)}</td>
                        </tr>
                    `;
                });
                shopHtml = `
                    <div style="flex:1; page-break-inside:avoid;">
                        <div style="font-size:12px; font-weight:700; color:#854d0e; padding-bottom:3px; margin-bottom:5px; border-bottom:1.5px solid #854d0e;">
                            🏬 SHOP EXPENSE
                        </div>
                        <table style="width:100%; border-collapse:collapse; font-size:10px;">
                            <thead>
                                <tr style="background:#854d0e; color:#fff;">
                                    <th style="padding:4px; text-align:center; width:8%;">#</th>
                                    <th style="padding:4px 6px; text-align:left;">Note</th>
                                    <th style="padding:4px 6px; text-align:right; width:35%;">Money</th>
                                </tr>
                            </thead>
                            <tbody>${sRows}</tbody>
                            <tfoot>
                                <tr style="background:#fefce8; font-weight:700;">
                                    <td colspan="2" style="padding:5px 6px; text-align:right;">Total:</td>
                                    <td style="padding:5px 6px; text-align:right;">${this.formatVal(this.totalShopexp)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                `;
            }

            let homeHtml = '';
            if (validHomeexp.length > 0) {
                let hRows = '';
                validHomeexp.forEach((l, idx) => {
                    hRows += `
                        <tr style="border-bottom:1px solid #e2e8f0;">
                            <td style="padding:4px; text-align:center;">${idx + 1}</td>
                            <td style="padding:4px 6px; text-align:left;">${l.note || '-'}</td>
                            <td style="padding:4px 6px; text-align:right; font-weight:600;">${this.formatVal(l.money)}</td>
                        </tr>
                    `;
                });
                homeHtml = `
                    <div style="flex:1; page-break-inside:avoid;">
                        <div style="font-size:12px; font-weight:700; color:#6b21a8; padding-bottom:3px; margin-bottom:5px; border-bottom:1.5px solid #6b21a8;">
                            🏠 HOME EXPENSE
                        </div>
                        <table style="width:100%; border-collapse:collapse; font-size:10px;">
                            <thead>
                                <tr style="background:#6b21a8; color:#fff;">
                                    <th style="padding:4px; text-align:center; width:8%;">#</th>
                                    <th style="padding:4px 6px; text-align:left;">Note</th>
                                    <th style="padding:4px 6px; text-align:right; width:35%;">Money</th>
                                </tr>
                            </thead>
                            <tbody>${hRows}</tbody>
                            <tfoot>
                                <tr style="background:#faf5ff; font-weight:700;">
                                    <td colspan="2" style="padding:5px 6px; text-align:right;">Total:</td>
                                    <td style="padding:5px 6px; text-align:right;">${this.formatVal(this.totalHomeexp)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                `;
            }

            expensesSection = `
                <div style="display:flex; gap:12px; margin-bottom:14px; page-break-inside:auto;">
                    ${shopHtml}
                    ${homeHtml}
                </div>
            `;
        }

        return `
            <div style="background:#ffffff; color:#1a1a1a; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size:11px; line-height:1.35; padding:10px 14px;">
                <!-- HEADER -->
                <div style="border-bottom:2px solid #2c3e50; padding-bottom:8px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:flex-end;">
                    <div>
                        <h1 style="margin:0; font-size:20px; font-weight:800; color:#2c3e50; text-transform:uppercase; letter-spacing:0.5px;">DAILY SALE SHEET</h1>
                        <div style="font-size:11px; color:#666; margin-top:2px;">
                            Date: <strong style="color:#0f172a;">${dateStr}</strong>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:12px; font-weight:700; color:#2c3e50; background:#f1f5f9; padding:4px 10px; border:1px solid #cbd5e1; border-radius:4px; display:inline-block;">
                            Date: <span style="color:#0f172a;">${dateStr}</span>
                        </div>
                    </div>
                </div>

                <!-- LAST WORKING DAY BALANCE -->
                <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:4px; padding:7px 12px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:700; color:#334155; font-size:12px;">Last Working Day Total Balance:</span>
                    <span style="font-weight:800; font-size:13px; color:#0f172a;">${lastBalStr}</span>
                </div>

                <!-- SALE TABLE -->
                <div style="margin-bottom:14px; page-break-inside:auto;">
                    <div style="font-size:13px; font-weight:700; color:#1e293b; padding-bottom:4px; margin-bottom:6px; border-bottom:1.5px solid #0f172a;">
                        🛒 SALE
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:10.5px; page-break-inside:auto;">
                        <thead>
                            <tr style="background-color:#1e293b; color:#ffffff;">
                                <th style="border:1px solid #0f172a; padding:5px 4px; text-align:center; width:4%;">#</th>
                                <th style="border:1px solid #0f172a; padding:5px 8px; text-align:left; width:18%;">Customer</th>
                                <th style="border:1px solid #0f172a; padding:5px 4px; text-align:center; width:8%;">Roll Qty</th>
                                <th style="border:1px solid #0f172a; padding:5px 8px; text-align:left; width:18%;">Item Name</th>
                                <th style="border:1px solid #0f172a; padding:5px 4px; text-align:right; width:11%;">Qty</th>
                                <th style="border:1px solid #0f172a; padding:5px 4px; text-align:center; width:7%;">Unit</th>
                                <th style="border:1px solid #0f172a; padding:5px 4px; text-align:right; width:10%;">Rate</th>
                                <th style="border:1px solid #0f172a; padding:5px 8px; text-align:right; width:12%;">Total</th>
                                <th style="border:1px solid #0f172a; padding:5px 8px; text-align:left; width:12%;">Note</th>
                            </tr>
                        </thead>
                        <tbody>${saleRowsHtml}</tbody>
                        <tfoot>
                            <tr style="background:#f1f5f9; font-weight:700;">
                                <td colspan="2" style="border:1px solid #94a3b8; padding:6px 8px; text-align:right;">Total Sale</td>
                                <td style="border:1px solid #94a3b8; padding:6px 4px; text-align:center;">${this.formatVal(this.totalSaleRollQty)}</td>
                                <td style="border:1px solid #94a3b8; padding:6px 8px;"></td>
                                <td style="border:1px solid #94a3b8; padding:6px 4px; text-align:right;">${this.formatVal(this.totalSaleMeterQty)}</td>
                                <td colspan="2" style="border:1px solid #94a3b8; padding:6px 8px;"></td>
                                <td style="border:1px solid #94a3b8; padding:6px 8px; text-align:right; font-size:11.5px; color:#166534;">${this.formatVal(this.totalSale)}</td>
                                <td style="border:1px solid #94a3b8; padding:6px 8px;"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                ${cashinSection}
                ${cashoutSection}
                ${expensesSection}

                <!-- CALCULATION SUMMARY -->
                <div style="page-break-inside:avoid; margin-top:14px; max-width:450px; margin-left:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:11px; border:1.5px solid #334155;">
                        <thead>
                            <tr style="background:#1e293b; color:#fff;">
                                <th colspan="2" style="padding:6px 10px; text-align:center; font-size:12px; font-weight:700;">
                                    CURRENT DAY TOTAL BALANCE
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border-bottom:1px solid #cbd5e1;">
                                <td style="padding:5px 10px; color:#334155;">Last Working Day Total Balance</td>
                                <td style="padding:5px 10px; text-align:right; font-weight:600;">${lastBalStr}</td>
                            </tr>
                            <tr style="border-bottom:1px solid #cbd5e1; background:#f0fdf4;">
                                <td style="padding:5px 10px; color:#166534; font-weight:600;">+ Sale</td>
                                <td style="padding:5px 10px; text-align:right; font-weight:700; color:#166534;">${this.formatVal(this.totalSale)}</td>
                            </tr>
                            <tr style="border-bottom:1px solid #cbd5e1; background:#f0fdf4;">
                                <td style="padding:5px 10px; color:#166534; font-weight:600;">+ Cash In</td>
                                <td style="padding:5px 10px; text-align:right; font-weight:700; color:#166534;">${this.formatVal(this.totalCashin)}</td>
                            </tr>
                            <tr style="border-bottom:1px solid #94a3b8; background:#f8fafc; font-weight:700;">
                                <td style="padding:6px 10px; color:#0f172a;">= Sub Total</td>
                                <td style="padding:6px 10px; text-align:right; color:#0f172a;">${this.formatVal(this.subTotal)}</td>
                            </tr>
                            <tr style="border-bottom:1px solid #cbd5e1; color:#991b1b;">
                                <td style="padding:5px 10px;">− Cash Out</td>
                                <td style="padding:5px 10px; text-align:right; font-weight:600;">${this.formatVal(this.totalCashout)}</td>
                            </tr>
                            <tr style="border-bottom:1px solid #cbd5e1; color:#991b1b;">
                                <td style="padding:5px 10px;">− Shop Expense</td>
                                <td style="padding:5px 10px; text-align:right; font-weight:600;">${this.formatVal(this.totalShopexp)}</td>
                            </tr>
                            <tr style="border-bottom:1.5px solid #334155; color:#991b1b;">
                                <td style="padding:5px 10px;">− Home Expense</td>
                                <td style="padding:5px 10px; text-align:right; font-weight:600;">${this.formatVal(this.totalHomeexp)}</td>
                            </tr>
                            <tr style="background:#2c7a4b; color:#ffffff; font-size:13px; font-weight:800;">
                                <td style="padding:8px 10px;">Current Day Total Balance</td>
                                <td style="padding:8px 10px; text-align:right;">${this.formatVal(this.currentDayBalance)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    printSheet() {
        let iframe = document.getElementById('cleanPrintIframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'cleanPrintIframe';
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';
            document.body.appendChild(iframe);
        }
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <title>Daily Sale Sheet - ${this.state.date}</title>
                    <style>
                        @page { size: A4 portrait; margin: 8mm; }
                        body { margin: 0; padding: 0; background: #ffffff; }
                    </style>
                </head>
                <body>
                    ${this.generateCleanReportHtml()}
                </body>
            </html>
        `);
        doc.close();
        setTimeout(() => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        }, 250);
    }

    async ensureHtml2Pdf() {
        if (window.html2pdf) return true;
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
            return true;
        } catch (e) {
            console.error("Failed to load html2pdf", e);
            return false;
        }
    }

    async downloadPDF() {
        const loaded = await this.ensureHtml2Pdf();
        if (!loaded) {
            this.printSheet();
            return;
        }

        if (this.notification) {
            this.notification.add("Generating Clean Salesheet PDF...", { type: "info" });
        }

        // Visible rendering overlay in viewport so html2canvas renders with positive bounds (NOT blank!)
        const overlay = document.createElement('div');
        overlay.id = 'cleanPdfExportOverlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(15, 23, 42, 0.85);
            z-index: 999999;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            overflow-y: auto;
            padding: 30px 10px;
            box-sizing: border-box;
        `;

        const badge = document.createElement('div');
        badge.style.cssText = `
            background: #ffffff;
            color: #0f172a;
            padding: 10px 24px;
            border-radius: 30px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        `;
        badge.innerHTML = `<span class="spinner-border spinner-border-sm text-primary" role="status"></span> Generating Clean Salesheet PDF... Please wait`;
        overlay.appendChild(badge);

        const reportContainer = document.createElement('div');
        reportContainer.id = 'cleanPdfContentToCapture';
        reportContainer.style.cssText = `
            width: 794px;
            max-width: 100%;
            background: #ffffff;
            color: #000000;
            padding: 24px;
            border-radius: 6px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            box-sizing: border-box;
        `;
        reportContainer.innerHTML = this.generateCleanReportHtml();
        overlay.appendChild(reportContainer);

        document.body.appendChild(overlay);

        // Wait 250ms for the browser layout engine to paint tables, borders, and typography
        await new Promise(resolve => setTimeout(resolve, 250));

        const opt = {
            margin: [0.3, 0.3, 0.3, 0.3],
            filename: `Daily_Sale_Sheet_${this.state.date}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                logging: false,
                scrollX: 0,
                scrollY: 0,
                windowWidth: 800,
                backgroundColor: '#ffffff'
            },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        try {
            await html2pdf().set(opt).from(reportContainer).save();
            if (this.notification) {
                this.notification.add("Clean Salesheet PDF Downloaded Successfully!", { type: "success" });
            }
        } catch (err) {
            console.error("PDF download failed", err);
            this.printSheet();
        } finally {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }
    }

    async shareToWhatsApp() {
        const loaded = await this.ensureHtml2Pdf();
        if (!loaded) {
            this.printSheet();
            return;
        }

        if (this.notification) {
            this.notification.add("Generating Clean PDF for WhatsApp...", { type: "info" });
        }

        const overlay = document.createElement('div');
        overlay.id = 'cleanPdfExportOverlayWA';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(15, 23, 42, 0.85);
            z-index: 999999;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            overflow-y: auto;
            padding: 30px 10px;
            box-sizing: border-box;
        `;

        const badge = document.createElement('div');
        badge.style.cssText = `
            background: #ffffff;
            color: #0f172a;
            padding: 10px 24px;
            border-radius: 30px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        `;
        badge.innerHTML = `<span class="spinner-border spinner-border-sm text-primary" role="status"></span> Preparing PDF for WhatsApp...`;
        overlay.appendChild(badge);

        const reportContainer = document.createElement('div');
        reportContainer.id = 'cleanPdfContentToCaptureWA';
        reportContainer.style.cssText = `
            width: 794px;
            max-width: 100%;
            background: #ffffff;
            color: #000000;
            padding: 24px;
            border-radius: 6px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            box-sizing: border-box;
        `;
        reportContainer.innerHTML = this.generateCleanReportHtml();
        overlay.appendChild(reportContainer);

        document.body.appendChild(overlay);

        await new Promise(resolve => setTimeout(resolve, 250));

        const opt = {
            margin: [0.3, 0.3, 0.3, 0.3],
            filename: `Daily_Sale_Sheet_${this.state.date}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                logging: false,
                scrollX: 0,
                scrollY: 0,
                windowWidth: 800,
                backgroundColor: '#ffffff'
            },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        const triggerFallback = (pdfBlob, filename) => {
            if (pdfBlob) {
                const url = URL.createObjectURL(pdfBlob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                URL.revokeObjectURL(url);
            }
            if (this.notification) {
                this.notification.add("PDF Downloaded! Please attach it in WhatsApp manually.", { type: "success" });
            }
            const msg = `Please find the daily sale sheet for ${this.state.date} attached as a PDF.`;
            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
        };

        try {
            const pdfBlob = await html2pdf().set(opt).from(reportContainer).outputPdf('blob');
            const file = new File([pdfBlob], opt.filename, { type: 'application/pdf' });
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            
            if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `Daily Sale Sheet ${this.state.date}`,
                    text: `Here is the daily sale sheet for ${this.state.date}.`,
                    files: [file]
                });
            } else {
                triggerFallback(pdfBlob, opt.filename);
            }
        } catch (err) {
            console.error("PDF generation failed", err);
            triggerFallback(null, opt.filename);
        } finally {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }
    }

    async saveSheet() {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.state.saveStatus = 'saving';
        try {
            const res = await rpc("/fabric_erp/save_daily_sheet", {
                date_str: this.state.date,
                last_balance: this.state.lastBalance,
                sale_lines: this.state.saleLines,
                cashin_lines: this.state.cashinLines,
                cashout_lines: this.state.cashoutLines,
                shopexp_lines: this.state.shopexpLines,
                homeexp_lines: this.state.homeexpLines,
                is_silent: false,
            });
            if (res && res.sale_lines_data) {
                res.sale_lines_data.forEach((sData, idx) => {
                    if (this.state.saleLines[idx] && sData.id) {
                        this.state.saleLines[idx].id = sData.id;
                    }
                });
            }
            if (res && res.customers && res.customers.length) {
                this.state.customers = res.customers;
            } else {
                const resCust = await rpc("/fabric_erp/get_customers");
                if (resCust && resCust.length) {
                    this.state.customers = resCust;
                }
            }
            if (res && res.products && res.products.length) {
                this.state.products = res.products;
            }

            // Ensure no saved lines are left in custom customer mode with the right (✓) button
            this.state.saleLines.forEach(l => { if (l.customer_name) l.is_custom_customer = false; });
            this.state.cashinLines.forEach(l => { if (l.customer_name) l.is_custom_customer = false; });
            this.state.cashoutLines.forEach(l => { if (l.customer_name) l.is_custom_customer = false; });

            this.state.saveStatus = 'saved';
            if (this.notification) {
                this.notification.add("Daily Sales Sheet Saved Successfully to Realtime Database!", { type: "success" });
            }
        } catch (e) {
            console.error("Failed to save daily sheet", e);
            this.state.saveStatus = 'unsaved';
            const errMsg = (e && e.data && e.data.message) || (e && e.message) || "Failed to save daily sheet!";
            if (this.notification) {
                this.notification.add(errMsg, { type: "danger" });
            }
        }
    }
}

registry.category("actions").add("fabric_erp.daily_sale_sheet", DailySaleSheetComponent);


