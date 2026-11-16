/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { FormController } from "@web/views/form/form_controller";
import { ListController } from "@web/views/list/list_controller";
import { ListRenderer } from "@web/views/list/list_renderer";
import { formatAmount } from "./fabric_amount_utils";
import { _t } from "@web/core/l10n/translation";

patch(FormController.prototype, {
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
                let latestRec = list.records[0];
                for (const rec of list.records) {
                    const rDate = rec.data.date ? new Date(rec.data.date).getTime() : 0;
                    const lDate = latestRec.data.date ? new Date(latestRec.data.date).getTime() : 0;
                    if (rDate > lDate || (rDate === lDate && (rec.data.id || 0) > (latestRec.data.id || 0))) {
                        latestRec = rec;
                    }
                }
                const finalBal = latestRec.data.running_balance || 0;
                aggregates["running_balance"].value = formatAmount(finalBal);
            }
        }
        return aggregates;
    },
});


