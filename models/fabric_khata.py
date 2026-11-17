from odoo import models, fields, api, _

class FabricKhataTransaction(models.Model):
    _name = 'fabric.khata.transaction'
    _inherit = ['fabric.time.limit.mixin', 'mail.thread', 'mail.activity.mixin']
    _description = 'Customer Khata Transaction Entry'
    _order = 'date desc, id desc'

    customer_id = fields.Many2one('fabric.customer', string='Customer', required=True, ondelete='cascade', tracking=True)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)
    currency_id = fields.Many2one('res.currency', related='company_id.currency_id', string='Currency')
    date = fields.Date(string='Date', default=fields.Date.context_today, required=True, tracking=True)
    entry_type = fields.Selection([
        ('jama', 'Jama (Payment Received)'),
        ('udhaar', 'Udhaar (Credit Sale)')
    ], string='Entry Type', required=True, tracking=True)
    particulars = fields.Char(string='Particulars / Notes', required=True, tracking=True)
    payment_method = fields.Selection([
        ('cash', 'Cash'),
        ('bank', 'Bank Transfer / NEFT'),
        ('upi', 'UPI / GPay / PhonePe'),
        ('cheque', 'Cheque')
    ], string='Payment Method', default='cash', required=True, tracking=True)
    amount = fields.Float(string='Amount', required=True, tracking=True)

    cash_in = fields.Float(string='Cash In (Jama)', compute='_compute_display_format', store=True)
    cash_out = fields.Float(string='Cash Out (Udhaar)', compute='_compute_display_format', store=True)
    display_date = fields.Char(string='Date', compute='_compute_display_format', store=True)
    signed_amount = fields.Float(string='Net Amount', compute='_compute_display_format', store=True)
    running_balance = fields.Float(string='Udhar / Net Balance', compute='_compute_running_balance', store=True)

    @api.depends('date', 'amount', 'entry_type')
    def _compute_display_format(self):
        for tx in self:
            if tx.date:
                tx.display_date = tx.date.strftime('%d-%b-%Y')
            else:
                tx.display_date = ''
            
            if tx.entry_type == 'jama':
                tx.cash_in = tx.amount or 0.0
                tx.cash_out = 0.0
                tx.signed_amount = tx.amount or 0.0
            elif tx.entry_type == 'udhaar':
                tx.cash_in = 0.0
                tx.cash_out = tx.amount or 0.0
                tx.signed_amount = -(tx.amount or 0.0)
            else:
                tx.cash_in = 0.0
                tx.cash_out = 0.0
                tx.signed_amount = 0.0

    @api.depends('customer_id.transaction_ids.date', 'customer_id.transaction_ids.amount', 'customer_id.transaction_ids.entry_type')
    def _compute_running_balance(self):
        customers = self.mapped('customer_id')
        for cust in customers:
            # Count from bottom to top (newest date/id up to oldest date/id)
            txs = cust.transaction_ids.sorted(key=lambda t: (t.date or fields.Date.today(), t.id or 0), reverse=True)
            bal = 0.0
            for tx in txs:
                if tx.entry_type == 'jama':
                    bal += (tx.amount or 0.0)
                elif tx.entry_type == 'udhaar':
                    bal -= (tx.amount or 0.0)
                tx.running_balance = bal
        for tx in self:
            if not tx.customer_id:
                tx.running_balance = (tx.amount or 0.0) if tx.entry_type == 'jama' else -(tx.amount or 0.0)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records.mapped('customer_id')._recompute_running_balances()
        return records

    def write(self, vals):
        res = super().write(vals)
        if any(k in vals for k in ['amount', 'entry_type', 'date', 'customer_id']):
            self.mapped('customer_id')._recompute_running_balances()
        return res

    def unlink(self):
        customers = self.mapped('customer_id')
        cashin_lines = self.env['fabric.daily.cashin.line'].search([('khata_transaction_id', 'in', self.ids)])
        if cashin_lines:
            cashin_lines.write({'is_khata': False, 'khata_transaction_id': False})
        cashout_lines = self.env['fabric.daily.cashout.line'].search([('khata_transaction_id', 'in', self.ids)])
        if cashout_lines:
            cashout_lines.write({'is_khata': False, 'khata_transaction_id': False})
        res = super().unlink()
        if customers:
            customers._recompute_running_balances()
            customers._compute_khata_totals()
        return res

    def action_delete_transaction(self):
        self.ensure_one()
        self.unlink()
        return {
            'type': 'ir.actions.client',
            'tag': 'reload',
        }

    def action_open_transaction(self):
        self.ensure_one()
        target_date = self.date or fields.Date.context_today(self)
        target_date_str = target_date.strftime('%Y-%m-%d')
        customer_name = self.customer_id.name if self.customer_id else ''
        target_section = 'sale-section'
        target_line_id = False
        target_model = False

        # 1. Check if directly linked to a Cash In line
        cashin_line = self.env['fabric.daily.cashin.line'].search([
            ('khata_transaction_id', '=', self.id)
        ], limit=1)
        if cashin_line:
            target_section = 'cashin-section'
            target_line_id = cashin_line.id
            target_model = 'fabric.daily.cashin.line'
            if cashin_line.sheet_id and cashin_line.sheet_id.date:
                target_date_str = cashin_line.sheet_id.date.strftime('%Y-%m-%d')
        else:
            # 2. Check if directly linked to a Cash Out line
            cashout_line = self.env['fabric.daily.cashout.line'].search([
                ('khata_transaction_id', '=', self.id)
            ], limit=1)
            if cashout_line:
                if cashout_line.sheet_id and cashout_line.sheet_id.date:
                    target_date_str = cashout_line.sheet_id.date.strftime('%Y-%m-%d')

                # Check if this cashout line was generated from an Unpaid Sale
                note = cashout_line.note or ''
                if 'Unpaid Sale' in note or 'Item:' in note:
                    target_section = 'sale-section'
                    sheet = cashout_line.sheet_id
                    if sheet:
                        sale_lines = sheet.sale_line_ids.filtered(lambda sl: sl.is_unpaid)
                        # Match by customer and amount
                        match = sale_lines.filtered(
                            lambda sl: (sl.customer_id == self.customer_id or sl.customer_name == customer_name)
                            and abs(sl.total_price - self.amount) < 0.01
                        )
                        if not match:
                            match = sale_lines.filtered(lambda sl: abs(sl.total_price - self.amount) < 0.01)
                        if match:
                            target_line_id = match[0].id
                            target_model = 'fabric.daily.sale.line'
                        else:
                            target_line_id = cashout_line.id
                            target_model = 'fabric.daily.cashout.line'
                            target_section = 'cashout-section'
                else:
                    target_section = 'cashout-section'
                    target_line_id = cashout_line.id
                    target_model = 'fabric.daily.cashout.line'
            else:
                # 3. If no direct link found, check matching sale or cashin line by customer and date
                if self.entry_type == 'jama':
                    target_section = 'cashin-section'
                    matching_sheet = self.env['fabric.daily.sheet'].search([('date', '=', target_date)], limit=1)
                    if matching_sheet:
                        c_line = matching_sheet.cashin_line_ids.filtered(
                            lambda cl: (cl.customer_id == self.customer_id or cl.customer_name == customer_name)
                            and abs(cl.money - self.amount) < 0.01
                        )
                        if c_line:
                            target_line_id = c_line[0].id
                            target_model = 'fabric.daily.cashin.line'
                else:
                    target_section = 'sale-section'
                    matching_sheet = self.env['fabric.daily.sheet'].search([('date', '=', target_date)], limit=1)
                    if matching_sheet:
                        s_line = matching_sheet.sale_line_ids.filtered(
                            lambda sl: (sl.customer_id == self.customer_id or sl.customer_name == customer_name)
                            and abs(sl.total_price - self.amount) < 0.01
                        )
                        if s_line:
                            target_line_id = s_line[0].id
                            target_model = 'fabric.daily.sale.line'
                        else:
                            co_line = matching_sheet.cashout_line_ids.filtered(
                                lambda cl: (cl.customer_id == self.customer_id or cl.customer_name == customer_name)
                                and abs(cl.money - self.amount) < 0.01
                            )
                            if co_line:
                                target_line_id = co_line[0].id
                                target_model = 'fabric.daily.cashout.line'
                                target_section = 'cashout-section'

        return {
            'type': 'ir.actions.client',
            'tag': 'fabric_erp.daily_sale_sheet',
            'name': f"Daily Sales Sheet ({target_date_str})",
            'params': {
                'default_date': target_date_str,
                'target_section': target_section,
                'target_customer': customer_name,
                'target_amount': self.amount,
                'target_line_id': target_line_id,
                'target_model': target_model,
                'target_khata_id': self.id,
                'target_particulars': self.particulars or '',
            },
            'context': {
                'default_date': target_date_str,
                'target_section': target_section,
                'target_customer': customer_name,
                'target_amount': self.amount,
                'target_line_id': target_line_id,
                'target_model': target_model,
                'target_khata_id': self.id,
                'target_particulars': self.particulars or '',
            }
        }

class FabricKhataTransactionWizard(models.TransientModel):
    _name = 'fabric.khata.transaction.wizard'
    _description = 'Wizard for Quick Khata Entry'

    customer_id = fields.Many2one('fabric.customer', string='Customer', required=True)
    date = fields.Date(string='Date', default=fields.Date.context_today, required=True)
    entry_type = fields.Selection([
        ('jama', 'Jama (Payment Received)'),
        ('udhaar', 'Udhaar (Credit Sale)')
    ], string='Entry Type', required=True, default='jama')
    particulars = fields.Char(string='Particulars / Notes', required=True, default='Payment Received')
    payment_method = fields.Selection([
        ('cash', 'Cash'),
        ('bank', 'Bank Transfer / NEFT'),
        ('upi', 'UPI / GPay / PhonePe'),
        ('cheque', 'Cheque')
    ], string='Payment Method', default='cash', required=True)
    amount = fields.Float(string='Amount', required=True)

    def action_save_transaction(self):
        self.ensure_one()
        self.env['fabric.khata.transaction'].create({
            'customer_id': self.customer_id.id,
            'date': self.date or fields.Date.context_today(self),
            'entry_type': self.entry_type,
            'particulars': self.particulars,
            'payment_method': self.payment_method,
            'amount': self.amount,
        })
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'fabric.customer',
            'res_id': self.customer_id.id,
            'view_mode': 'form',
            'target': 'current',
        }
