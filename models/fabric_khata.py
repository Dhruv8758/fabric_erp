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
        return {
            'type': 'ir.actions.act_window',
            'name': 'Khata Transaction',
            'res_model': 'fabric.khata.transaction',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'current',
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
