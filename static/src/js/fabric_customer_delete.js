/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { FormController } from "@web/views/form/form_controller";
import { ListController } from "@web/views/list/list_controller";
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
