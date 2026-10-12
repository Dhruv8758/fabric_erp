from odoo import models, fields, api

class FabricProduct(models.Model):
    _name = 'fabric.product'
    _description = 'Fabric Product'
    company_id = fields.Many2one('res.company', string='Company', required=True, default=lambda self: self.env.company)

    _inherit = ['mail.thread', 'mail.activity.mixin']

    name = fields.Char(string='Product Name', required=True, tracking=True)
    code = fields.Char(string='Product Code', tracking=True)
    unit = fields.Selection([
        ('Meter', 'Meter'),
        ('Yard', 'Yard'),
        ('Roll', 'Roll')
    ], string='Unit', default='Meter', tracking=True)
    price_per_unit = fields.Float(string='Default Price', default=0.0, tracking=True)
    
    quantity = fields.Float(string='Current Stock', compute='_compute_quantity', store=True, tracking=True)
    
    stock_entry_ids = fields.One2many('fabric.product.stock.entry', 'product_id', string='Stock Ledger')

    @api.depends('stock_entry_ids.quantity', 'stock_entry_ids.entry_type')
    def _compute_quantity(self):
        for product in self:
            stock_in = sum(entry.quantity for entry in product.stock_entry_ids if entry.entry_type == 'in')
            stock_out = sum(entry.quantity for entry in product.stock_entry_ids if entry.entry_type == 'out')
            product.quantity = stock_in - stock_out

    def action_manual_stock_in(self):
        self.ensure_one()
        return {
            'name': 'Update Stock (In)',
            'type': 'ir.actions.act_window',
            'res_model': 'fabric.product.stock.entry',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_product_id': self.id,
                'default_entry_type': 'in',
                'default_reference': 'Manual Stock Update',
            }
        }


class FabricContainer(models.Model):
    _name = 'fabric.container'
    _description = 'Fabric Container'
    company_id = fields.Many2one('res.company', string='Company', required=True, default=lambda self: self.env.company)


    name = fields.Char(string='Container Name', required=True)


class FabricProductStockEntry(models.Model):
    _name = 'fabric.product.stock.entry'
    _description = 'Product Stock Ledger Entry'
    company_id = fields.Many2one('res.company', string='Company', required=True, default=lambda self: self.env.company)

    _order = 'date desc, id desc'

    product_id = fields.Many2one('fabric.product', string='Product', required=True, ondelete='cascade')
    date = fields.Date(string='Date', default=fields.Date.context_today, required=True)
    entry_type = fields.Selection([
        ('in', 'Stock In'),
        ('out', 'Stock Out / Sale')
    ], string='Type', required=True)
    quantity = fields.Float(string='Quantity', required=True)
    signed_quantity = fields.Float(string='Net Qty', compute='_compute_signed_quantity', store=True)
    reference = fields.Char(string='Reference')
    sale_line_id = fields.Many2one('fabric.daily.sale.line', string='Sale Line', ondelete='set null')
    container_id = fields.Many2one('fabric.container', string='Container')
    date_formatted = fields.Char(string='Date Formatted', compute='_compute_date_formatted')

    @api.depends('date')
    def _compute_date_formatted(self):
        for entry in self:
            if entry.date:
                entry.date_formatted = entry.date.strftime('%d-%b-%Y').lower()
            else:
                entry.date_formatted = ''

    @api.depends('quantity', 'entry_type')
    def _compute_signed_quantity(self):
        for entry in self:
            entry.signed_quantity = -entry.quantity if entry.entry_type == 'out' else entry.quantity
