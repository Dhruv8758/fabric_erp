from odoo import models, fields, api

class FabricUnit(models.Model):
    _name = 'fabric.unit'
    _description = 'Fabric Unit Master'
    _order = 'sequence asc, name asc'

    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)
    name = fields.Char(string='Unit Name', required=True)
    code = fields.Char(string='Code')
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    _sql_constraints = [
        ('name_uniq', 'unique(name, company_id)', 'Unit name must be unique per company!')
    ]
