from odoo import models, fields, api, _

class FabricVisitNote(models.Model):
    _name = 'fabric.visit.note'
    _inherit = ['fabric.time.limit.mixin', 'mail.thread', 'mail.activity.mixin']
    _description = 'Customer Shop Visit Quick Note'
    company_id = fields.Many2one('res.company', string='Company', required=True, default=lambda self: self.env.company)

    _order = 'date desc, id desc'

    date = fields.Datetime(string='Date & Time', default=fields.Datetime.now, required=True, tracking=True)
    credited_date = fields.Datetime(string='Credited Date & Time', tracking=True)
    customer_id = fields.Many2one('fabric.customer', string='Customer', tracking=True)
    customer_name = fields.Char(string='Customer / Shop Name', tracking=True)
    description = fields.Text(string='Description / Note', required=True, tracking=True)
    roll_qty = fields.Float(string='Roll Qty', default=0.0, tracking=True)
    qty = fields.Float(string='Meter / Qty', default=0.0, tracking=True)
    unit = fields.Selection([('Meter', 'Meter'), ('Yard', 'Yard')], string='Unit', default='Meter', tracking=True)
    roll_meters_str = fields.Char(string='Roll Meters Breakdown')
    amount = fields.Float(string='Amount', default=0.0, tracking=True)
    is_credited = fields.Boolean(string='Money Credited (Green Highlight)', default=False, tracking=True)
    is_over_24h = fields.Boolean(compute='_compute_time_display', search='_search_over_24h', string='Over 24h Entry')
    date_12h = fields.Char(compute='_compute_time_display', string='Date & Time (12h)')
    time_added_str = fields.Char(compute='_compute_time_display', string='Time Added / Credit Time')
    duration_str = fields.Char(compute='_compute_time_display', string='Duration')

    def _search_over_24h(self, operator, value):
        from datetime import timedelta
        cutoff = fields.Datetime.now() - timedelta(days=1)
        positive = (operator == '=' and bool(value)) or (operator == '!=' and not bool(value))
        if positive:
            return [('date', '<=', cutoff)]
        else:
            return [('date', '>', cutoff)]

    @api.depends('date', 'is_credited', 'credited_date')
    def _compute_time_display(self):
        now = fields.Datetime.now()
        for rec in self:
            if rec.date:
                rec.date_12h = fields.Datetime.context_timestamp(rec, rec.date).strftime('%d/%m/%Y %I:%M %p')
                diff_sec = (now - rec.date).total_seconds()
                # Over 24h regardless of whether credited or not
                rec.is_over_24h = bool(diff_sec >= 86400)
                if diff_sec < 60:
                    rec.duration_str = 'Just now'
                elif diff_sec < 3600:
                    mins = int(diff_sec // 60)
                    rec.duration_str = f"{mins} mins ago"
                elif diff_sec < 86400:
                    hours = int(diff_sec // 3600)
                    rec.duration_str = f"{hours} hrs ago"
                else:
                    days = int(diff_sec // 86400)
                    rec.duration_str = f"{days} days ago"
            else:
                rec.date_12h = ''
                rec.duration_str = ''
                rec.is_over_24h = False

            # If credited, show credit time; otherwise show creation time added in 12-hour format
            display_dt = rec.credited_date if (rec.is_credited and rec.credited_date) else rec.date
            if display_dt:
                rec.time_added_str = fields.Datetime.context_timestamp(rec, display_dt).strftime('%I:%M %p')
            else:
                rec.time_added_str = ''

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('is_credited') and not vals.get('credited_date'):
                vals['credited_date'] = fields.Datetime.now()
        return super().create(vals_list)

    def write(self, vals):
        if 'is_credited' in vals:
            if vals['is_credited']:
                vals['credited_date'] = fields.Datetime.now()
            else:
                vals['credited_date'] = False
        return super().write(vals)

    def action_toggle_credited(self):
        for rec in self:
            new_status = not rec.is_credited
            rec.write({
                'is_credited': new_status,
                'credited_date': fields.Datetime.now() if new_status else False
            })
