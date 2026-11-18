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

            const getBackdrop = () => {
                let backdrop = document.querySelector(".fabric-drawer-backdrop");
                if (!backdrop) {
                    backdrop = document.createElement("div");
                    backdrop.className = "fabric-drawer-backdrop";
                    backdrop.style.display = "none";
                    document.body.appendChild(backdrop);
                    backdrop.addEventListener("click", () => {
                        closeAllDrawers();
                    });
                }
                return backdrop;
            };

            const closeAllDrawers = () => {
                const summaryDrawer = document.querySelector(".fabric-summary-drawer");
                const chatterDrawer = document.querySelector(".fabric-chatter-drawer");
                const backdrop = document.querySelector(".fabric-drawer-backdrop");
                const summaryBtn = document.querySelector(".fabric-toggle-summary-btn");
                const chatterBtn = document.querySelector(".fabric-chatter-shortcut-btn");

                if (summaryDrawer) {
                    summaryDrawer.classList.remove("is-open");
                    setTimeout(() => {
                        if (!summaryDrawer.classList.contains("is-open")) {
                            summaryDrawer.style.display = "none";
                        }
                    }, 300);
                }
                if (chatterDrawer) {
                    chatterDrawer.classList.remove("is-open");
                    setTimeout(() => {
                        if (!chatterDrawer.classList.contains("is-open")) {
                            chatterDrawer.style.display = "none";
                        }
                    }, 300);
                }
                if (backdrop) {
                    backdrop.classList.remove("is-open");
                    setTimeout(() => {
                        if (!backdrop.classList.contains("is-open")) {
                            backdrop.style.display = "none";
                        }
                    }, 300);
                }
                if (summaryBtn) summaryBtn.classList.remove("is-active");
                if (chatterBtn) chatterBtn.classList.remove("is-active");
            };

            const openSummaryDrawer = (root) => {
                const summaryDrawer = root.querySelector(".fabric-summary-drawer");
                const chatterDrawer = root.querySelector(".fabric-chatter-drawer") || document.querySelector(".fabric-chatter-drawer");
                const backdrop = getBackdrop();
                const summaryBtn = root.querySelector(".fabric-toggle-summary-btn");
                const chatterBtn = root.querySelector(".fabric-chatter-shortcut-btn");

                if (summaryDrawer && summaryDrawer.classList.contains("is-open")) {
                    closeAllDrawers();
                    return;
                }

                if (chatterDrawer) {
                    chatterDrawer.classList.remove("is-open");
                    chatterDrawer.style.display = "none";
                }
                if (chatterBtn) chatterBtn.classList.remove("is-active");

                if (summaryDrawer) {
                    summaryDrawer.style.display = "flex";
                    summaryDrawer.offsetHeight;
                    summaryDrawer.classList.add("is-open");
                }
                if (backdrop) {
                    backdrop.style.display = "block";
                    backdrop.offsetHeight;
                    backdrop.classList.add("is-open");
                }
                if (summaryBtn) summaryBtn.classList.add("is-active");
            };

            const openChatterDrawer = (root) => {
                const chatterDrawer = root.querySelector(".fabric-chatter-drawer") || document.querySelector(".fabric-chatter-drawer");
                const summaryDrawer = root.querySelector(".fabric-summary-drawer");
                const backdrop = getBackdrop();
                const summaryBtn = root.querySelector(".fabric-toggle-summary-btn");
                const chatterBtn = root.querySelector(".fabric-chatter-shortcut-btn");

                if (chatterDrawer && chatterDrawer.classList.contains("is-open")) {
                    closeAllDrawers();
                    return;
                }

                if (summaryDrawer) {
                    summaryDrawer.classList.remove("is-open");
                    summaryDrawer.style.display = "none";
                }
                if (summaryBtn) summaryBtn.classList.remove("is-active");

                if (chatterDrawer) {
                    chatterDrawer.style.display = "flex";
                    chatterDrawer.offsetHeight;
                    chatterDrawer.classList.add("is-open");
                }
                if (backdrop) {
                    backdrop.style.display = "block";
                    backdrop.offsetHeight;
                    backdrop.classList.add("is-open");
                }
                if (chatterBtn) chatterBtn.classList.add("is-active");
            };

            const initDrawers = (root) => {
                if (!root) return;
                getBackdrop();

                // Setup Summary Drawer Close Button
                const summaryClose = root.querySelector(".fabric-summary-drawer .fabric-drawer-close-btn");
                if (summaryClose && !summaryClose._hasFabricClick) {
                    summaryClose._hasFabricClick = true;
                    summaryClose.addEventListener("click", (e) => {
                        e.preventDefault();
                        closeAllDrawers();
                    });
                }

                // Setup Summary Trigger Button
                const summaryBtn = root.querySelector(".fabric-toggle-summary-btn");
                if (summaryBtn && !summaryBtn._hasFabricClick) {
                    summaryBtn._hasFabricClick = true;
                    summaryBtn.addEventListener("click", (e) => {
                        e.preventDefault();
                        openSummaryDrawer(root);
                    });
                }

                // Setup Chatter Drawer
                const chatter = root.querySelector(".o-mail-Form-chatter") || root.querySelector(".o-mail-ChatterContainer");
                if (chatter) {
                    chatter.classList.add("fabric-slide-drawer", "fabric-chatter-drawer");
                    if (!chatter.classList.contains("is-open")) {
                        chatter.style.display = "none";
                    }

                    let headerBar = chatter.querySelector(".chatter-drawer-header-bar");
                    if (!headerBar) {
                        headerBar = document.createElement("div");
                        headerBar.className = "chatter-drawer-header-bar drawer-header-bar d-flex justify-content-between align-items-center p-3 border-bottom bg-light";
                        headerBar.innerHTML = `
                            <div class="d-flex align-items-center gap-2">
                                <div class="drawer-header-icon-box">
                                    <i class="fa fa-comments text-primary" title="Chatter"></i>
                                </div>
                                <div>
                                    <h5 class="fw-bold text-dark m-0" style="font-size: 1.05rem;">ACTIVITY &amp; CHATTER HISTORY</h5>
                                    <span class="text-muted small">Notes, Logs &amp; Message History</span>
                                </div>
                            </div>
                            <span role="button" class="fabric-drawer-close-btn" title="Close Drawer">&times;</span>
                        `;
                        chatter.insertBefore(headerBar, chatter.firstChild);

                        headerBar.querySelector(".fabric-drawer-close-btn").addEventListener("click", (e) => {
                            e.preventDefault();
                            closeAllDrawers();
                        });
                    }
                }

                // Setup Chatter Trigger Button
                const chatterBtn = root.querySelector(".fabric-chatter-shortcut-btn");
                if (chatterBtn && !chatterBtn._hasFabricClick) {
                    chatterBtn._hasFabricClick = true;
                    chatterBtn.addEventListener("click", (e) => {
                        e.preventDefault();
                        openChatterDrawer(root);
                    });
                }
            };

            if (!window._fabricEscapeHandlerBound) {
                window._fabricEscapeHandlerBound = true;
                document.addEventListener("keydown", (e) => {
                    if (e.key === "Escape") {
                        closeAllDrawers();
                    }
                });
            }

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

                    // Initialize Slide-Over Drawers
                    initDrawers(root);

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

            const ensureAllTransactionsLoaded = () => {
                const list = this.model?.root?.data?.transaction_ids;
                if (list) {
                    if (list.limit < 10000) {
                        list.limit = 10000;
                    }
                    if (list.count > list.records.length) {
                        list.load({ limit: 10000, offset: 0 });
                    }
                }
            };

            onMounted(() => {
                ensureAllTransactionsLoaded();
                scrollToTotal();
            });

            useEffect(
                (resId) => {
                    closeAllDrawers();
                    if (resId) {
                        ensureAllTransactionsLoaded();
                        scrollToTotal();
                    }
                },
                () => [this.model?.root?.resId]
            );

            onWillUnmount(() => {
                closeAllDrawers();
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


