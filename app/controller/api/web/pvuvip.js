'use strict';
const parser = require('cron-parser');
const Controller = require('egg').Controller;

class PvUvIpController extends Controller {
    // 获得实时概况
    async getPvUvIpSurvey() {
        const { ctx } = this;
        const query = ctx.request.query;
        const appId = query.appId;
        if (!appId) throw new Error('pvuvip概况统计：appId不能为空');
        // 今日数据概况
        const endTime_today = new Date();
        const beginTime_today = this.app.format(endTime_today, 'yyyy/MM/dd') + ' 00:00:00';
        const today = await ctx.service.web.pvuvip.getPvUvIpSurvey(appId, beginTime_today, endTime_today);

        ctx.body = this.app.result({
            data: today,
        });
    }
    // 某日概况
    async getPvUvIpSurveyOne() {
        const { ctx } = this;
        const query = ctx.request.query;
        const appId = query.appId;
        const beginTime = query.beginTime;
        const endTime = query.endTime;
        if (!appId) throw new Error('pvuvip概况统计：appId不能为空');
        if (!beginTime) throw new Error('pvuvip概况统计：beginTime不能为空');
        if (!endTime) throw new Error('pvuvip概况统计：endTime不能为空');

        const result = await ctx.service.web.pvuvip.getPvUvIpSurveyOne(appId, beginTime, endTime);

        ctx.body = this.app.result({
            data: result,
        });
    }
    // 获得历史概况
    async getHistoryPvUvIplist() {
        const { ctx } = this;
        const query = ctx.request.query;
        const appId = query.appId;
        if (!appId) throw new Error('pvuvip获得历史概况：appId不能为空');
        const result = await ctx.service.web.pvuvip.getHistoryPvUvIplist(appId);

        ctx.body = this.app.result({
            data: result,
        });
    }
    // 获得多条数据
    async getPvUvIpList() {
        const { ctx } = this;
        const query = ctx.request.body;
        const appId = query.appId;
        // 参数校验
        if (!appId) throw new Error('界面查询pvuvip：appId不能为空');

        // 计算定时任务间隔
        const interval = parser.parseExpression(this.app.config.pvuvip_task_minute_time);
        const betweenTime = Math.abs(new Date(interval.next().toString()).getTime() - new Date(interval.next().toString()).getTime());

        const timestrat = new Date().getTime();
        const beginTime = query.beginTime || new Date(timestrat - betweenTime * 30 - 60000);
        const endTime = query.endTime || new Date(timestrat - 60000);

        const datalist = await ctx.service.web.pvuvip.getPvUvIpData(appId, beginTime, endTime) || [];
        const result = await this.getTimeList(beginTime, endTime, datalist);

        ctx.body = this.app.result({
            data: result,
        });
    }
    // 获得单条数据
    async getPvUvIpOne() {
        const { ctx } = this;
        const query = ctx.request.body;
        const appId = query.appId;
        // 参数校验
        if (!appId) throw new Error('界面查询pvuvip：appId不能为空');

        const timestrat = new Date().getTime();
        const beginTime = new Date(timestrat - 120000);
        const endTime = new Date(timestrat - 60000);

        const datalist = await ctx.service.web.pvuvip.getPvUvIpData(appId, beginTime, endTime) || [];
        let result = {};
        if (datalist.length) {
            result = {
                time: datalist[0].create_time,
                pv: datalist[0].pv,
                uv: datalist[0].uv,
                ip: datalist[0].ip,
            };
        } else {
            result = {
                time: this.app.format(endTime, 'yyyy/MM/dd HH:mm') + ':00',
                pv: 0,
                uv: 0,
                ip: 0,
            };
        }
        ctx.body = this.app.result({
            data: result,
        });
    }
    // 获得时间列表
    async getTimeList(beginTime, endTime, datalist) {
        const result = [];
        const options = {
            currentDate: new Date(beginTime),
            endDate: new Date(endTime),
            iterator: true,
        };
        const interval = parser.parseExpression(this.app.config.pvuvip_task_minute_time, options);
        while (true) { // eslint-disable-line
            try {
                const obj = interval.next();
                const date = new Date(obj.value.toString());
                const timer = this.app.format(date, 'yyyy/MM/dd HH:mm:ss');
                const items = {
                    time: timer,
                    pv: 0,
                    uv: 0,
                    ip: 0,
                };
                datalist.forEach(item => {
                    if (date.getTime() === new Date(item.create_time).getTime()) {
                        items.pv = item.pv;
                        items.uv = item.uv;
                        items.ip = item.ip;
                    }
                });
                result.push(items);
            } catch (e) {
                break;
            }
        }
        return result;
    }
}

module.exports = PvUvIpController;
