from odoo import models, fields, api, _
from odoo.exceptions import UserError

class FabricDailySheet(models.Model):
    _name = 'fabric.daily.sheet'
    _inherit = ['fabric.time.limit.mixin', 'mail.thread', 'mail.activity.mixin']
    _description = 'Daily Sales Sheet'
    _order = 'date desc, id desc'
    _rec_name = 'display_name'

    date = fields.Date(string='Sheet Date', default=fields.Date.today, required=True, tracking=True)
    display_name = fields.Char(compute='_compute_display_name', store=True)
    last_balance = fields.Float(string='Last Working Day Balance', default=0.0, tracking=True)

    sale_line_ids = fields.One2many('fabric.daily.sale.line', 'sheet_id', string='Sales Lines')
    cashin_line_ids = fields.One2many('fabric.daily.cashin.line', 'sheet_id', string='Cash In Lines')
    cashout_line_ids = fields.One2many('fabric.daily.cashout.line', 'sheet_id', string='Cash Out Lines')
    shopexp_line_ids = fields.One2many('fabric.daily.shopexp.line', 'sheet_id', string='Shop Expenses')
    homeexp_line_ids = fields.One2many('fabric.daily.homeexp.line', 'sheet_id', string='Home Expenses')

    total_sale = fields.Float(compute='_compute_sheet_totals', string='Total Sale', store=True, tracking=True)
    total_cashin = fields.Float(compute='_compute_sheet_totals', string='Total Cash In', store=True, tracking=True)
    total_cashout = fields.Float(compute='_compute_sheet_totals', string='Total Cash Out', store=True, tracking=True)
    total_shopexp = fields.Float(compute='_compute_sheet_totals', string='Total Shop Expense', store=True, tracking=True)
    total_homeexp = fields.Float(compute='_compute_sheet_totals', string='Total Home Expense', store=True, tracking=True)
    sub_total = fields.Float(compute='_compute_sheet_totals', string='Sub Total', store=True, tracking=True)
    current_day_balance = fields.Float(compute='_compute_sheet_totals', string='Current Day Total Balance', store=True, tracking=True)

    @api.depends('date')
    def _compute_display_name(self):
        for sheet in self:
            sheet.display_name = f"Daily Sheet: {sheet.date}"



    @api.depends('last_balance', 'sale_line_ids.total_price', 'cashin_line_ids.money', 
                 'cashout_line_ids.money', 'shopexp_line_ids.money', 'homeexp_line_ids.money')
    def _compute_sheet_totals(self):
        for s in self:
            s.total_sale = sum(line.total_price for line in s.sale_line_ids)
            s.total_cashin = sum(line.money for line in s.cashin_line_ids)
            s.total_cashout = sum(line.money for line in s.cashout_line_ids)
            s.total_shopexp = sum(line.money for line in s.shopexp_line_ids)
            s.total_homeexp = sum(line.money for line in s.homeexp_line_ids)

            s.sub_total = s.last_balance + s.total_sale + s.total_cashin
            s.current_day_balance = s.sub_total - s.total_cashout - s.total_shopexp - s.total_homeexp


class FabricDailySaleLine(models.Model):
    _name = 'fabric.daily.sale.line'
    _inherit = ['fabric.time.limit.mixin']
    _description = 'Daily Sale Line'

    sheet_id = fields.Many2one('fabric.daily.sheet', string='Sheet Reference', ondelete='cascade')
    sequence = fields.Integer(string='No', default=1)
    roll_qty = fields.Float(string='Roll/Bail Qty', default=0.0)
    qty = fields.Float(string='Meter/Yard Qty', default=0.0)
    customer_id = fields.Many2one('fabric.customer', string='Customer')
    customer_name = fields.Char(string='Customer Name')
    product_id = fields.Many2one('fabric.product', string='Product')

    item_name = fields.Char(string='Item / Fabric Name', required=True)
    unit = fields.Selection([
        ('Meter', 'Meter'),
        ('Yard', 'Yard')
    ], string='Unit', default='Meter', required=True)

    price_per_unit = fields.Float(string='Price per M/Y', default=0.0)
    total_price = fields.Float(string='Total Price', default=0.0)
    note = fields.Char(string='Note / Remarks')
    roll_meters_str = fields.Char(string='Roll Meters Breakdown')
    is_unpaid = fields.Boolean(string='Unpaid / Cash Out Sync', default=False)

    @api.onchange('qty', 'price_per_unit')
    def _onchange_calc_total(self):
        if self.qty and self.price_per_unit:
            self.total_price = self.qty * self.price_per_unit

    @api.model_create_multi
    def create(self, vals_list):
        lines = super().create(vals_list)
        for line in lines:
            if line.product_id and line.qty > 0:
                self.env['fabric.product.stock.entry'].create({
                    'product_id': line.product_id.id,
                    'date': line.sheet_id.date or fields.Date.context_today(self),
                    'entry_type': 'out',
                    'quantity': line.qty,
                    'reference': f'Sale {line.sheet_id.display_name}',
                    'sale_line_id': line.id,
                })
        return lines

    def write(self, vals):
        res = super().write(vals)
        for line in self:
            if 'qty' in vals or 'product_id' in vals:
                entry = self.env['fabric.product.stock.entry'].search([('sale_line_id', '=', line.id)], limit=1)
                if line.product_id and line.qty > 0:
                    if entry:
                        entry.write({
                            'product_id': line.product_id.id,
                            'quantity': line.qty,
                            'date': line.sheet_id.date or fields.Date.context_today(self),
                        })
                    else:
                        self.env['fabric.product.stock.entry'].create({
                            'product_id': line.product_id.id,
                            'date': line.sheet_id.date or fields.Date.context_today(self),
                            'entry_type': 'out',
                            'quantity': line.qty,
                            'reference': f'Sale {line.sheet_id.display_name}',
                            'sale_line_id': line.id,
                        })
                elif entry:
                    entry.unlink()
        return res


class FabricDailyCashinLine(models.Model):
    _name = 'fabric.daily.cashin.line'
    _inherit = ['fabric.time.limit.mixin']
    _description = 'Daily Cash In Line'

    sheet_id = fields.Many2one('fabric.daily.sheet', string='Sheet Reference', ondelete='cascade')
    sequence = fields.Integer(string='No', default=1)
    customer_id = fields.Many2one('fabric.customer', string='Customer')
    customer_name = fields.Char(string='Customer Name')
    note = fields.Char(string='Name / Note', required=True)
    money = fields.Float(string='Money', required=True)
    is_khata = fields.Boolean(string='Khata Sync (Jama)', default=False)


class FabricDailyCashoutLine(models.Model):
    _name = 'fabric.daily.cashout.line'
    _inherit = ['fabric.time.limit.mixin']
    _description = 'Daily Cash Out Line'

    sheet_id = fields.Many2one('fabric.daily.sheet', string='Sheet Reference', ondelete='cascade')
    sequence = fields.Integer(string='No', default=1)
    customer_id = fields.Many2one('fabric.customer', string='Customer')
    customer_name = fields.Char(string='Customer Name')
    note = fields.Char(string='Name / Note', required=True)
    money = fields.Float(string='Money', required=True)
    is_khata = fields.Boolean(string='Khata Sync (Udhaar)', default=False)


class FabricDailyShopexpLine(models.Model):
    _name = 'fabric.daily.shopexp.line'
    _inherit = ['fabric.time.limit.mixin']
    _description = 'Daily Shop Expense Line'

    sheet_id = fields.Many2one('fabric.daily.sheet', string='Sheet Reference', ondelete='cascade')
    sequence = fields.Integer(string='No', default=1)
    note = fields.Char(string='Note', required=True)
    money = fields.Float(string='Money', required=True)


class FabricDailyHomeexpLine(models.Model):
    _name = 'fabric.daily.homeexp.line'
    _inherit = ['fabric.time.limit.mixin']
    _description = 'Daily Home Expense Line'

    sheet_id = fields.Many2one('fabric.daily.sheet', string='Sheet Reference', ondelete='cascade')
    sequence = fields.Integer(string='No', default=1)
    note = fields.Char(string='Note', required=True)
    money = fields.Float(string='Money', required=True)
