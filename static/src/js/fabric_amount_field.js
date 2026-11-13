/** @odoo-module **/

import { registry } from "@web/core/registry";
import { formatFloat } from "@web/views/fields/formatters";
import { parseFloat as parseOdooFloat } from "@web/views/fields/parsers";
import { FloatField, floatField } from "@web/views/fields/float/float_field";

const THREE_DIGIT_FORMAT_OPTIONS = {
    grouping: [3, 0],
    thousandsSep: ",",
    decimalPoint: ".",
    trailingZeros: false,
};

export function formatFabricAmount(value, options = {}) {
    return formatFloat(value, {
        ...options,
        ...THREE_DIGIT_FORMAT_OPTIONS,
    });
}
formatFabricAmount.extractOptions = formatFloat.extractOptions;

export class FabricAmountField extends FloatField {
    parse(value) {
        if (this.props.inputType === "number") {
            return Number(value);
        }
        const cleaned =
            typeof value === "string" && !value.startsWith("=")
                ? value.replace(/,/g, "")
                : value;
        return parseOdooFloat(cleaned);
    }

    get formattedValue() {
        if (
            !this.props.formatNumber ||
            (this.props.inputType === "number" && !this.props.readonly && this.value)
        ) {
            return this.value;
        }
        const options = {
            digits: this.props.digits,
            field: this.props.record.fields[this.props.name],
            ...THREE_DIGIT_FORMAT_OPTIONS,
        };
        if (this.props.humanReadable && !this.state.hasFocus) {
            return formatFloat(this.value, {
                ...options,
                humanReadable: true,
                decimals: this.props.decimals,
            });
        }
        return formatFloat(this.value, { ...options, humanReadable: false });
    }
}

export const fabricAmountField = {
    ...floatField,
    component: FabricAmountField,
    displayName: "Fabric Amount (3-Digit Grouping)",
};

registry.category("formatters").add("fabric_amount", formatFabricAmount);
registry.category("fields").add("fabric_amount", fabricAmountField);

