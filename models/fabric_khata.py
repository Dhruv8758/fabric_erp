from odoo import models, fields, api, _

class FabricKhataTransaction(models.Model):
    _name = 'fabric.khata.transaction'
    _inherit = ['fabric.time.limit.mixin', 'mail.thread', 'mail.activity.mixin']
    _description = 'Customer Khata Transaction Entry'
    _order = 'date desc, id desc'

    customer_id = fields.Many2one('fabric.customer', string='Customer', required=True, ondelete='cascade', tracking=True)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)
    currency_id = fields.Many2one('res.currency', related='company_id.currency_id', string='Currency')
    date = fields.Datetime(string='Date & Time', default=fields.Datetime.now, required=True, tracking=True)
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

    display_date = fields.Char(string='Date & Time', compute='_compute_display_format', store=True)
    signed_amount = fields.Float(string='Net Amount', compute='_compute_display_format', store=True)

    @api.depends('date', 'amount', 'entry_type')
    def _compute_display_format(self):
        for tx in self:
            if tx.date:
                tx.display_date = tx.date.strftime('%d-%b-%Y %I:%M %p')
            else:
                tx.display_date = ''
            
            if tx.entry_type == 'udhaar':
                tx.signed_amount = tx.amount
            else:
                tx.signed_amount = -tx.amount





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
