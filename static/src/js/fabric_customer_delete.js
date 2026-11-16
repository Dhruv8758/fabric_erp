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


