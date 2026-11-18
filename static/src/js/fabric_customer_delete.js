/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { FormController } from "@web/views/form/form_controller";
import { ListController } from "@web/views/list/list_controller";
import { ListRenderer } from "@web/views/list/list_renderer";
import { formatAmount } from "./fabric_amount_utils";
import { _t } from "@web/core/l10n/translation";
import { onMounted, useEffect, onWillUnmount } from "@odoo/owl";

patch(FormController.prototype, {
    setup() {
        super.setup(...arguments);
        if (this.props.resModel === "fabric.customer") {
            let scrollTimer = null;

            const initSummaryToggle = (root) => {
                if (!root) return;
                const toggleBtn = root.querySelector(".fabric-toggle-summary-btn");
                const summaryCard = root.querySelector(".fabric-unique-summary-card");
                if (toggleBtn && summaryCard && !toggleBtn._hasFabricClick) {
                    toggleBtn._hasFabricClick = true;
                    toggleBtn.addEventListener("click", (e) => {
                        e.preventDefault();
                        const isHidden = summaryCard.style.display === "none";
                        summaryCard.style.display = isHidden ? "block" : "none";
                        toggleBtn.classList.toggle("is-open", isHidden);
                        const label = toggleBtn.querySelector(".summary-btn-text");
                        const arrow = toggleBtn.querySelector(".summary-btn-arrow");
                        if (label) label.textContent = isHidden ? "Hide Summary" : "View Summary";
                        if (arrow) {
                            arrow.className = isHidden ? "fa fa-chevron-up ms-1 summary-btn-arrow" : "fa fa-chevron-down ms-1 summary-btn-arrow";
                        }
                    });
                }
            };

            const initChatterShortcut = (root) => {
                if (!root) return;
                const shortcutBtn = root.querySelector(".fabric-chatter-shortcut-btn");
                if (shortcutBtn && !shortcutBtn._hasFabricClick) {
                    shortcutBtn._hasFabricClick = true;
                    shortcutBtn.addEventListener("click", (e) => {
                        e.preventDefault();
                        const chatter = root.querySelector(".o-mail-Form-chatter") || root.querySelector(".o-mail-ChatterContainer");
                        const toggleBar = root.querySelector(".fabric-chatter-minimal-divider");
                        if (chatter) {
                            chatter.style.display = "";
                            if (toggleBar) {
                                const pill = toggleBar.querySelector(".chatter-toggle-pill");
                                if (pill) {
                                    pill.classList.add("is-open");
                                    const chevron = pill.querySelector(".chatter-chevron");
                                    if (chevron) chevron.className = "fa fa-chevron-up ms-1 chatter-chevron";
                                }
                            }
                            chatter.scrollIntoView({ behavior: "smooth", block: "start" });
                        }
                    });
                }
            };

            const initChatterCollapse = (root) => {
                if (!root) return;
                const chatter = root.querySelector(".o-mail-Form-chatter") || root.querySelector(".o-mail-ChatterContainer");
                if (!chatter) return;

                let toggleBar = root.querySelector(".fabric-chatter-minimal-divider");
                if (!toggleBar) {
                    toggleBar = document.createElement("div");
                    toggleBar.className = "fabric-chatter-minimal-divider";
                    toggleBar.innerHTML = `
                        <div class="divider-line"></div>
                        <span role="button" class="fabric-pill-btn-unique chatter-toggle-pill">
                            <i class="fa fa-comments-o text-primary"></i>
                            <span class="chatter-label">Activity Notes, Logs &amp; Message History</span>
                            <i class="fa fa-chevron-down ms-1 chatter-chevron"></i>
                        </span>
                    `;
                    chatter.parentNode.insertBefore(toggleBar, chatter);

                    // Natively hide chatter by default
                    chatter.style.display = "none";

                    toggleBar.querySelector(".chatter-toggle-pill").addEventListener("click", () => {
                        const isHidden = chatter.style.display === "none";
                        const pill = toggleBar.querySelector(".chatter-toggle-pill");
                        const chevron = toggleBar.querySelector(".chatter-chevron");
                        if (isHidden) {
                            chatter.style.display = "";
                            pill.classList.add("is-open");
                            if (chevron) chevron.className = "fa fa-chevron-up ms-1 chatter-chevron";
                        } else {
                            chatter.style.display = "none";
                            pill.classList.remove("is-open");
                            if (chevron) chevron.className = "fa fa-chevron-down ms-1 chatter-chevron";
                        }
                    });
                } else {
                    // Reset to collapsed when switching records
                    chatter.style.display = "none";
                    const pill = toggleBar.querySelector(".chatter-toggle-pill");
                    if (pill) {
                        pill.classList.remove("is-open");
                        const chevron = pill.querySelector(".chatter-chevron");
                        if (chevron) chevron.className = "fa fa-chevron-down ms-1 chatter-chevron";
                    }
                }
            };

            const scrollToTotal = () => {
                if (scrollTimer) {
                    clearInterval(scrollTimer);
                    scrollTimer = null;
                }
                let attempts = 0;
                const maxAttempts = 15;
                scrollTimer = setInterval(() => {
                    attempts++;
                    const root = this.rootRef && this.rootRef.el;
                    if (!root) {
                        if (attempts >= maxAttempts) {
                            clearInterval(scrollTimer);
                            scrollTimer = null;
                        }
                        return;
                    }

                    // Initialize UI enhancements
                    initSummaryToggle(root);
                    initChatterShortcut(root);
                    initChatterCollapse(root);

                    const tfoot = root.querySelector("[name='transaction_ids'] tfoot") ||
                                  root.querySelector("[name='transaction_ids'] .o_list_footer");
                    const target = (tfoot && (tfoot.querySelector("tr") || tfoot)) ||
                                   root.querySelector("[name='transaction_ids']");
                    const content = root.querySelector(".o_content") || root.closest?.(".o_content") || document.querySelector(".o_content");

                    if (target && target.scrollIntoView) {
                        target.scrollIntoView({ block: "end", inline: "nearest" });
                        if (tfoot && attempts >= 3) {
                            clearInterval(scrollTimer);
                            scrollTimer = null;
                        }
                    } else if (content) {
                        content.scrollTop = content.scrollHeight;
                    }

                    if (attempts >= maxAttempts) {
                        clearInterval(scrollTimer);
                        scrollTimer = null;
                    }
                }, 50);
            };

            onMounted(() => {
                scrollToTotal();
            });

            useEffect(
                (resId) => {
                    if (resId) {
                        scrollToTotal();
                    }
                },
                () => [this.model?.root?.resId]
            );

            onWillUnmount(() => {
                if (scrollTimer) {
                    clearInterval(scrollTimer);
                    scrollTimer = null;
                }
            });
        }
    },
    get deleteConfirmationDialogProps() {
        const props = super.deleteConfirmationDialogProps;
        if (this.model && this.model.root && this.model.root.resModel === "fabric.customer") {
            props.body = _t("Warning: Deleting this customer will delete all Sale, Cash In, and Cash Out entries from the Sale Sheet and Khata. Are you sure you want to proceed?");
        }
        return props;
    },
});

patch(ListController.prototype, {
    get deleteConfirmationDialogProps() {
        const props = super.deleteConfirmationDialogProps;
        if (this.model && this.model.root && this.model.root.resModel === "fabric.customer") {
            props.body = _t("Warning: Deleting this customer will delete all Sale, Cash In, and Cash Out entries from the Sale Sheet and Khata. Are you sure you want to proceed?");
        }
        return props;
    },
});

patch(ListRenderer.prototype, {
    get aggregates() {
        const aggregates = super.aggregates;
        if (aggregates && aggregates["running_balance"]) {
            const list = this.props.list;
            if (list && list.resModel === "fabric.khata.transaction" && list.records && list.records.length > 0) {
                let totalIn = 0;
                let totalOut = 0;
                for (const rec of list.records) {
                    totalIn += (rec.data.cash_in || 0);
                    totalOut += (rec.data.cash_out || 0);
                }
                const netBal = totalIn - totalOut;
                aggregates["running_balance"].value = formatAmount(netBal);
            }
        }
        return aggregates;
    },
});


