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
                { id: 1, customer_name: '', roll_qty: '', qty: '', item_name: '', unit: 'Meter', price: '', total: '', note: '', is_unpaid: false }
            ],
            cashinLines: [
                { id: 1, customer_name: '', note: '', money: '', is_khata: false }
            ],
            cashoutLines: [
                { id: 1, customer_name: '', note: '', money: '', is_khata: false }
            ],
            shopexpLines: [
                { id: 1, note: '', money: '' }
            ],
            homeexpLines: [
                { id: 1, note: '', money: '' }
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
            const data = await rpc("/fabric_erp/get_daily_sheet_by_date", { date_str: dateStr });
            const cleanZero = (val) => (val === 0 || val === '0' || val === 0.0 || !val) ? '' : val;
            if (data && data.exists) {
                this.state.current_uid = data.current_uid;
                this.state.lastBalance = cleanZero(data.last_balance);
                this.state.saleLines = (data.saleLines || []).map(l => ({
                    ...l,
                    roll_qty: cleanZero(l.roll_qty),
                    qty: cleanZero(l.qty),
                    price: cleanZero(l.price),
                    total: cleanZero(l.total)
                }));
                this.state.cashinLines = (data.cashinLines || []).map(l => ({
                    ...l,
                    money: cleanZero(l.money)
                }));
                this.state.cashoutLines = (data.cashoutLines || []).map(l => {
                    const noteStr = (l.note || '').trim();
                    const isCustom = l.is_custom_customer !== undefined ? l.is_custom_customer : (
                        noteStr.startsWith('Unpaid Sale:') || (noteStr && !this.state.customers.some(c => (c.name || '').toLowerCase() === noteStr.toLowerCase()))
                    );
                    return {
                        ...l,
                        money: cleanZero(l.money),
                        is_custom_customer: isCustom
                    };
                });
                this.state.shopexpLines = (data.shopexpLines || []).map(l => ({
                    ...l,
                    money: cleanZero(l.money)
                }));
                this.state.homeexpLines = (data.homeexpLines || []).map(l => ({
                    ...l,
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

    async onDateChange(ev) {
        this.state.date = ev.target.value;
        globalLastSelectedDate = this.state.date;
        await this.loadSheetByDate(this.state.date);
    }

    formatVal(val) {
        const num = parseFloat(val);
        return (isNaN(num) ? 0 : num).toFixed(2).replace(/\.00$/, '');
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
            return parseFloat(cust.current_net_balance).toFixed(2).replace(/\.00$/, '');
        }
        return null;
    }

    getProductStock(nameStr) {
        if (!nameStr) return null;
        const prod = (this.state.products || []).find(p => p.name === nameStr);
        if (prod && prod.quantity !== undefined) {
            return parseFloat(prod.quantity).toFixed(2).replace(/\.00$/, '');
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
        if (val && !this.state.customers.some(c => (c.name || '').toLowerCase() === val.toLowerCase())) {
            this.state.customers.push({ id: Date.now() + Math.random(), name: val });
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
                this.state.cashoutLines[existingIdx].is_custom_customer = true;
                // Preserve the existing is_khata value instead of forcing it to true
            } else {
                const newCashout = {
                    id: Date.now() + Math.random(),
                    syncedSaleId: line.id,
                    customer_name: custName,
                    note: noteText,
                    money: totalMoney,
                    is_custom_customer: true,
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
        return sum.toFixed(2);
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
            is_unpaid: false
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
            line.total = (q * p).toFixed(2);
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
        this.state.cashinLines.push({ id: Date.now() + Math.random(), customer_name: '', note: '', money: '', is_khata: false });
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
        if (val && !this.state.customers.some(c => (c.name || '').toLowerCase() === val.toLowerCase())) {
            this.state.customers.push({ id: Date.now() + Math.random(), name: val });
        }
    }

    addCashoutRow() {
        this.state.cashoutLines.push({ id: Date.now() + Math.random(), customer_name: '', note: '', money: '', is_khata: false });
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
        if (val && !this.state.customers.some(c => (c.name || '').toLowerCase() === val.toLowerCase())) {
            this.state.customers.push({ id: Date.now() + Math.random(), name: val });
        }
    }

    addShopexpRow() {
        this.state.shopexpLines.push({ id: Date.now() + Math.random(), note: '', money: '' });
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
        this.state.homeexpLines.push({ id: Date.now() + Math.random(), note: '', money: '' });
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
            this.saveSheetSilently();
        }, 1200);
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
            if (res && res.products && res.products.length) {
                this.state.products = res.products;
            }
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

    printSheet() {
        window.print();
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
            if (this.notification) this.notification.add("Opening print dialog...", { type: "info" });
            window.print();
            return;
        }

        const reportEl = document.getElementById('cleanPrintReport');
        if (!reportEl) {
            window.print();
            return;
        }

        if (this.notification) {
            this.notification.add("Generating Clean Salesheet PDF...", { type: "info" });
        }

        const clone = reportEl.cloneNode(true);
        clone.id = 'cleanPrintReportClone';
        clone.style.display = 'block';
        clone.style.position = 'fixed';
        clone.style.top = '-99999px';
        clone.style.left = '0';
        clone.style.width = '794px';
        clone.style.background = '#ffffff';
        clone.style.color = '#000000';
        document.body.appendChild(clone);

        const opt = {
            margin: [0.25, 0.25, 0.25, 0.25],
            filename: `Daily_Sale_Sheet_${this.state.date}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        try {
            await html2pdf().set(opt).from(clone).save();
            if (this.notification) {
                this.notification.add("Clean Salesheet PDF Downloaded Successfully!", { type: "success" });
            }
        } catch (err) {
            console.error("PDF download failed", err);
            window.print();
        } finally {
            if (clone.parentNode) {
                clone.parentNode.removeChild(clone);
            }
        }
    }

    async shareToWhatsApp() {
        const loaded = await this.ensureHtml2Pdf();
        if (!loaded) {
            if (this.notification) this.notification.add("Failed to load PDF generator. Using Print dialog instead.", { type: "warning" });
            window.print();
            return;
        }

        const reportEl = document.getElementById('cleanPrintReport');
        if (!reportEl) {
            window.print();
            return;
        }

        if (this.notification) {
            this.notification.add("Generating Clean PDF for WhatsApp...", { type: "info" });
        }

        const clone = reportEl.cloneNode(true);
        clone.id = 'cleanPrintReportCloneWA';
        clone.style.display = 'block';
        clone.style.position = 'fixed';
        clone.style.top = '-99999px';
        clone.style.left = '0';
        clone.style.width = '794px';
        clone.style.background = '#ffffff';
        clone.style.color = '#000000';
        document.body.appendChild(clone);

        const opt = {
            margin: [0.25, 0.25, 0.25, 0.25],
            filename: `Daily_Sale_Sheet_${this.state.date}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        const triggerFallback = (pdfBlob, filename) => {
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            
            if (this.notification) {
                this.notification.add("PDF Downloaded! Please attach it in WhatsApp manually.", { type: "success" });
            }
            const msg = `Please find the daily sale sheet for ${this.state.date} attached as a PDF.`;
            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
        };

        try {
            const pdfBlob = await html2pdf().set(opt).from(clone).outputPdf('blob');
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
            if (clone.parentNode) {
                clone.parentNode.removeChild(clone);
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
            const resCust = await rpc("/fabric_erp/get_customers");
            if (resCust && resCust.length) {
                this.state.customers = resCust;
            }
            const resProducts = await rpc("/fabric_erp/get_products");
            if (resProducts && resProducts.length) {
                this.state.products = resProducts;
            }

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


