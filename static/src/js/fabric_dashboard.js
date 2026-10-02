/** @odoo-module **/

import { Component, useState, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { useService } from "@web/core/utils/hooks";

export class FabricDashboard extends Component {
    static template = "fabric_erp.FabricDashboard";

    setup() {
        this.action = useService("action");

        // Load initial temp notes from localStorage
        let savedTempNotes = [];
        try {
            const raw = localStorage.getItem("fabric_temp_shop_notes");
            if (raw) {
                savedTempNotes = JSON.parse(raw);
            }
        } catch(e) {
            console.error("Failed to parse localStorage fabric_temp_shop_notes", e);
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const monthStr = todayStr.substring(0, 7);
        const yearVal = new Date().getFullYear();

        this.state = useState({
            date: "",
            filterType: "today",
            selectedDate: todayStr,
            selectedMonth: monthStr,
            selectedYear: yearVal,
            periodLabel: "TODAY",
            periodTitle: `Today (${todayStr})`,
            availableMonths: [],
            availableYears: [yearVal],
            todays_sales: 0,
            bills_count: 0,
            udhaar_due: 0,
            shop_expense: 0,
            home_expense: 0,
            recent_sales: [],
            recent_expenses: [],
            monthly_expenses: [],
            // Temp Visit Notes State
            tempNotes: savedTempNotes,
            tempNoteFilter: "all",
            newNoteDesc: "",
            newNoteRoll: "",
            newNoteMeter: "",
            newNoteUnit: "Meter",
            newNoteAmount: "",
            newNoteCredited: false,
            showTempNoteModal: false,
            showVisitRollModal: false,
            visitRollMeters: [],
            visitRollUnit: "Meter",
            quickVisitRollInputStr: "",
            visitRollBreakdownStr: "",
            nowTimeTick: Date.now(),
        });

        onWillStart(async () => {
            await this.loadDashboardData();
        });

        onMounted(() => {
            this.timerInterval = setInterval(() => {
                this.state.nowTimeTick = Date.now();
            }, 10000);
        });

        onWillUnmount(() => {
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
            }
        });
    }

    async loadDashboardData() {
        try {
            const data = await rpc("/fabric_erp/dashboard_data", {
                filter_type: this.state.filterType,
                date_val: this.state.selectedDate,
                month_val: this.state.selectedMonth,
                year_val: this.state.selectedYear,
            });
            if (data) {
                this.state.date = data.date || "";
                this.state.periodLabel = data.period_label || "TODAY";
                this.state.periodTitle = data.period_title || "Today";
                this.state.todays_sales = data.todays_sales || 0;
                this.state.bills_count = data.bills_count || 0;
                this.state.udhaar_due = data.udhaar_due || 0;
                this.state.shop_expense = data.shop_expense || 0;
                this.state.home_expense = data.home_expense || data.home_draws || 0;
                this.state.recent_sales = data.recent_sales || [];
                this.state.recent_expenses = data.recent_expenses || [];
                this.state.monthly_expenses = data.monthly_expenses || [];
                if (data.available_months && data.available_months.length) {
                    this.state.availableMonths = data.available_months;
                }
                if (data.available_years && data.available_years.length) {
                    this.state.availableYears = data.available_years;
                }
            }
            const visitNotes = await rpc("/fabric_erp/get_temp_visit_notes", {});
            if (visitNotes && visitNotes.length) {
                this.state.tempNotes = visitNotes;
            }
        } catch (e) {
            console.error("Failed to load fabric dashboard data", e);
        }
    }

    async setFilterType(type) {
        this.state.filterType = type;
        await this.loadDashboardData();
    }

    async onFilterValueChange() {
        await this.loadDashboardData();
    }

    formatNum(num) {
        if (num === undefined || num === null) return "0";
        return Number(num).toLocaleString('en-IN').replace(/[^0-9.,-]/g, '').trim();
    }

    openDailySaleSheet(section) {
        if (section && typeof section === 'string') {
            window.fabric_target_section = section;
        }
        this.action.doAction("fabric_erp.action_fabric_daily_sheet_interactive", {
            additionalContext: { target_section: section }
        });
    }

    openCustomerKhata() {
        this.action.doAction("fabric_erp.action_fabric_customer");
    }

    openCustomerKhataForm() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            name: 'New Customer / Jama',
            res_model: 'fabric.customer',
            views: [[false, 'form']],
            target: 'current'
        });
    }



    isOver24Hours(createdAtStr) {
        if (!createdAtStr) return false;
        const dummy = this.state.nowTimeTick;
        const created = new Date(createdAtStr);
        const diffMs = Date.now() - created.getTime();
        if (isNaN(diffMs) || diffMs < 0) return false;
        return diffMs >= 24 * 60 * 60 * 1000;
    }

    // Roll Meter Breakdown Modal Handlers for Visit Notes
    openVisitRollModal() {
        const count = Math.max(1, Math.floor(parseFloat(this.state.newNoteRoll) || 1));
        let arr = [];
        if (this.state.visitRollBreakdownStr) {
            const parts = this.state.visitRollBreakdownStr.split(/[+,\s]+/).map(p => parseFloat(p)).filter(n => !isNaN(n) && n > 0);
            if (parts.length) {
                arr = parts;
            }
        }
        while (arr.length < count) {
            arr.push(0);
        }
        this.state.visitRollMeters = arr;
        this.state.quickVisitRollInputStr = arr.filter(n => n > 0).join(" + ");
        this.state.showVisitRollModal = true;
    }

    closeVisitRollModal() {
        this.state.showVisitRollModal = false;
    }

    onQuickVisitRollInput(val) {
        this.state.quickVisitRollInputStr = val;
        const parts = val.split(/[+,\s]+/).map(p => parseFloat(p)).filter(n => !isNaN(n) && n > 0);
        if (parts.length) {
            this.state.visitRollMeters = parts;
        }
    }

    updateVisitRollMeter(idx, val) {
        const num = parseFloat(val) || 0;
        this.state.visitRollMeters[idx] = num;
        this.state.quickVisitRollInputStr = this.state.visitRollMeters.filter(n => n > 0).join(" + ");
    }

    get visitRollTotalMeters() {
        const sum = (this.state.visitRollMeters || []).reduce((acc, m) => acc + (parseFloat(m) || 0), 0);
        return sum.toFixed(2);
    }

    addVisitRollRow() {
        this.state.visitRollMeters.push(0);
    }

    removeVisitRollRow(idx) {
        if (this.state.visitRollMeters.length > 1) {
            this.state.visitRollMeters.splice(idx, 1);
            this.state.quickVisitRollInputStr = this.state.visitRollMeters.filter(n => n > 0).join(" + ");
        }
    }

    applyVisitRollBreakdown() {
        const sum = (this.state.visitRollMeters || []).reduce((acc, m) => acc + (parseFloat(m) || 0), 0);
        const validMeters = this.state.visitRollMeters.filter(m => parseFloat(m) > 0);
        this.state.newNoteMeter = sum.toFixed(2);
        this.state.newNoteRoll = validMeters.length || this.state.visitRollMeters.length;
        this.state.visitRollBreakdownStr = validMeters.map(m => parseFloat(m)).join(" + ");
        this.closeVisitRollModal();
    }

    // Quick Temp Notes Methods
    get filteredTempNotes() {
        const notes = this.state.tempNotes || [];
        if (this.state.tempNoteFilter === 'credited') {
            return notes.filter(n => n.isCredited);
        } else if (this.state.tempNoteFilter === 'pending') {
            return notes.filter(n => !n.isCredited);
        } else if (this.state.tempNoteFilter === 'overdue') {
            return notes.filter(n => this.isOver24Hours(n.createdAt));
        }
        return notes;
    }

    get totalTempNotesAmount() {
        return (this.state.tempNotes || []).reduce((sum, n) => sum + (parseFloat(n.amount) || 0), 0);
    }

    get totalCreditedAmount() {
        return (this.state.tempNotes || [])
            .filter(n => n.isCredited)
            .reduce((sum, n) => sum + (parseFloat(n.amount) || 0), 0);
    }

    get creditedCount() {
        return (this.state.tempNotes || []).filter(n => n.isCredited).length;
    }

    get pendingCount() {
        return (this.state.tempNotes || []).filter(n => !n.isCredited).length;
    }

    get overdueCount() {
        return (this.state.tempNotes || []).filter(n => this.isOver24Hours(n.createdAt)).length;
    }

    saveTempNotesToStorage() {
        try {
            localStorage.setItem("fabric_temp_shop_notes", JSON.stringify(this.state.tempNotes));
        } catch(e) {
            console.error("Failed to save temp notes to localStorage", e);
        }
    }

    async toggleCreditStatus(note) {
        if (note) {
            note.isCredited = !note.isCredited;
            const now = new Date();
            if (note.isCredited) {
                note.creditedAt = now.toISOString();
                note.formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            } else {
                note.creditedAt = null;
                if (note.createdAt) {
                    const created = new Date(note.createdAt);
                    note.formattedTime = created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                }
            }
            this.saveTempNotesToStorage();
            if (note.id) {
                try {
                    const res = await rpc("/fabric_erp/toggle_temp_visit_note_credit", { note_id: note.id });
                    if (res && res.formattedTime) {
                        note.formattedTime = res.formattedTime;
                        note.creditedAt = res.creditedAt;
                        this.saveTempNotesToStorage();
                    }
                } catch(e) { console.error("RPC toggle error", e); }
            }
        }
    }

    async addTempNote(asCredited = false) {
        if (!this.state.newNoteDesc && !this.state.newNoteAmount && !this.state.newNoteRoll && !this.state.newNoteMeter) return;
        const desc = this.state.newNoteDesc || 'Customer Shop Visit Note';
        const rollVal = parseFloat(this.state.newNoteRoll) || 0;
        const meterVal = parseFloat(this.state.newNoteMeter) || 0;
        const unitVal = this.state.newNoteUnit || 'Meter';
        const breakdownVal = this.state.visitRollBreakdownStr || '';
        const amt = parseFloat(this.state.newNoteAmount) || 0;
        const isCred = Boolean(asCredited || this.state.newNoteCredited);

        try {
            const res = await rpc("/fabric_erp/add_temp_visit_note", {
                description: desc,
                roll_qty: rollVal,
                qty: meterVal,
                unit: unitVal,
                roll_meters_str: breakdownVal,
                amount: amt,
                is_credited: isCred
            });
            if (res && res.note) {
                this.state.tempNotes.unshift(res.note);
            }
        } catch(e) {
            const now = new Date();
            const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            const newEntry = {
                id: Date.now() + Math.random(),
                description: desc,
                rollQty: rollVal,
                qty: meterVal,
                unit: unitVal,
                roll_meters_str: breakdownVal,
                amount: amt,
                isCredited: isCred,
                createdAt: now.toISOString(),
                formattedTime: formattedTime
            };
            this.state.tempNotes.unshift(newEntry);
        }
        this.state.newNoteDesc = "";
        this.state.newNoteRoll = "";
        this.state.newNoteMeter = "";
        this.state.newNoteAmount = "";
        this.state.newNoteCredited = false;
        this.state.visitRollBreakdownStr = "";
        this.saveTempNotesToStorage();
    }

    async removeTempNote(noteId) {
        const idx = (this.state.tempNotes || []).findIndex(n => n.id === noteId);
        if (idx !== -1) {
            this.state.tempNotes.splice(idx, 1);
            this.saveTempNotesToStorage();
            try {
                await rpc("/fabric_erp/delete_temp_visit_note", { note_id: noteId });
            } catch(e) {}
        }
    }

    async clearAllTempNotes() {
        this.state.tempNotes = [];
        this.saveTempNotesToStorage();
        try {
            await rpc("/fabric_erp/clear_all_temp_visit_notes", {});
        } catch(e) {}
    }

    setTempFilter(filterKey) {
        this.state.tempNoteFilter = filterKey;
    }

    openQuickTempNoteModal() {
        this.state.showTempNoteModal = true;
        setTimeout(() => {
            const el = document.getElementById("temp-visit-notes-section");
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 150);
    }

    closeQuickTempNoteModal() {
        this.state.showTempNoteModal = false;
    }

    async addTempNoteAndClose(asCredited = false) {
        await this.addTempNote(asCredited);
        this.closeQuickTempNoteModal();
    }

    getDurationStr(createdAtStr) {
        if (!createdAtStr) return 'Just now';
        const dummy = this.state.nowTimeTick;
        const created = new Date(createdAtStr);
        const diffMs = Date.now() - created.getTime();
        if (isNaN(diffMs) || diffMs < 0) return 'Just now';

        const diffSecs = Math.floor(diffMs / 1000);
        if (diffSecs < 45) return 'Just now';

        const diffMins = Math.floor(diffSecs / 60);
        if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;

        const diffHours = Math.floor(diffMins / 60);
        const remMins = diffMins % 60;
        if (diffHours < 24) {
            return remMins > 0 ? `${diffHours}h ${remMins}m ago` : `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
        }

        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
}

registry.category("actions").add("fabric_erp.dashboard", FabricDashboard);
