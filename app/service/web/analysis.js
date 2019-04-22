'use strict';

const Service = require('egg').Service;

class AnalysisService extends Service {

    // 用户漏斗分析列表
    async getAnalysislist(appId, beginTime, endTime, ip, pageNo, pageSize) {
        pageNo = pageNo * 1;
        pageSize = pageSize * 1;

        const query = { $match: { } };
        if (ip) query.$match.ip = ip;
        if (beginTime && endTime) query.$match.create_time = { $gte: new Date(beginTime), $lte: new Date(endTime) };

        return ip ? await this.oneThread(appId, query, pageNo, pageSize)
            : await this.moreThread(appId, beginTime, endTime, query, pageNo, pageSize);
    }

    // 平均求值数多线程
    async moreThread(appId, beginTime, endTime, queryjson, pageNo, pageSize) {
        const result = [];
        let distinct = await this.app.models.WebEnvironment(appId).distinct('mark_user', queryjson.$match).exec() || [];
        const copdistinct = distinct;

        const betinIndex = (pageNo - 1) * pageSize;
        if (distinct && distinct.length) {
            distinct = distinct.slice(betinIndex, betinIndex + pageSize);
        }
        const resolvelist = [];
        for (let i = 0, len = distinct.length; i < len; i++) {
            resolvelist.push(
                Promise.resolve(
                    this.app.models.WebEnvironment(appId).aggregate([
                        { $match: { mark_user: distinct[i], create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) } } },
                        {
                            $group: {
                                _id: {
                                    ip: '$ip',
                                    markuser: '$mark_user',
                                    browser: '$browser',
                                    system: '$system',
                                    createTime:'$create_time'
                                },
                            },
                        },
                    ]).read('sp')
                        .exec()
                )
            );
        }
        const all = await Promise.all(resolvelist) || [];
        all.forEach(item => {
            result.push(item[0]);
        });

        return {
            datalist: result,
            totalNum: copdistinct.length,
            pageNo,
        };
    }

    // 单个api接口查询平均信息
    async oneThread(appId, queryjson, pageNo, pageSize) {
        const count = Promise.resolve(this.app.models.WebEnvironment(appId).distinct('mark_user', queryjson.$match).exec());
        const datas = Promise.resolve(
            this.app.models.WebEnvironment(appId).aggregate([
                queryjson,
                {
                    $group: {
                        _id: {
                            ip: '$ip',
                            markuser: '$mark_user',
                            browser: '$browser',
                            system: '$system',
                            createTime:'$create_time'
                        },
                    },
                },
                { $skip: (pageNo - 1) * pageSize },
                { $sort: { count: -1 } },
                { $limit: pageSize },
            ]).read('sp')
                .exec()
        );
        const all = await Promise.all([ count, datas ]);
        return {
            datalist: all[1],
            totalNum: all[0].length,
            pageNo,
        };
    }

    // 单个用户行为轨迹列表
    async getAnalysisOneList(appId, markuser) {
        return await this.app.models.WebEnvironment(appId)
            .find({ mark_user: markuser })
            .read('sp')
            .sort({ cerate_time: 1 })
            .exec() || {};
    }

    // TOP datas
    async getTopDatas(appId, beginTime, endTime, type) {
        type = type * 1;
        let result = {};
        if (type === 1) {
            const pages = Promise.resolve(this.getRealTimeTopPages(appId, beginTime, endTime));
            const jump = Promise.resolve(this.getRealTimeTopJumpOut(appId, beginTime, endTime));
            const all = await Promise.all([ pages, jump ]);
            result = { top_pages: all[0], top_jump_out: all[1] };
        } else if (type === 2) {
            result = await this.getDbTopPages(appId, beginTime, endTime) || {};
        }
        return result;
    }

    // 历史 top
    async getDbTopPages(appId, beginTime, endTime) {
        const data = await this.ctx.model.Web.WebStatis.findOne({ app_id: appId, create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) } }).read('sp').exec();
        if (data) return data;
        // 不存在则储存
        return await this.saveRealTimeTopTask(appId, 2, beginTime, endTime);
    }
    // top 页面
    async getRealTimeTopPages(appId, beginTime, endTime) {
        let result = await this.app.redis.get(`${appId}_top_pages_realtime`);
        result = result ? JSON.parse(result) : await this.getRealTimeTopPagesForDb(appId, beginTime, endTime);
        return result;
    }
    async getRealTimeTopPagesForDb(appId, beginTime, endTime, type) {
        try {
            const result = await this.app.models.WebPages(appId).aggregate([
                { $match: { create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) } } },
                {
                    $group: {
                        _id: { url: '$url' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { count: -1 } },
                { $limit: this.app.config.top_alalysis_size.web || 10 },
            ])
                .read('sp')
                .exec();

            // 每分钟执行存储到redis
            if (type === 1) this.app.redis.set(`${appId}_top_pages_realtime`, JSON.stringify(result));
            return result;
        } catch (err) { console.log(err); }
    }
    // top跳出率
    async getRealTimeTopJumpOut(appId, beginTime, endTime) {
        let result = await this.app.redis.get(`${appId}_top_jump_out_realtime`);
        result = result ? JSON.parse(result) : await this.getRealTimeTopJumpOutForDb(appId, beginTime, endTime);
        return result;
    }
    async getRealTimeTopJumpOutForDb(appId, beginTime, endTime, type) {
        try {
            /* eslint-disable */
            const option = {
                map: function () { emit(this.mark_user, this.url); },
                reduce: function (key, values) {
                    return values.length === 1;
                },
                query: { create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) } },
                out: { replace: 'collectionName' },
            };
            /* eslint-enable */
            const res = await this.app.models.WebEnvironment(appId).mapReduce(option);
            const result = await res.model.aggregate([
                { $match: { value: { $ne: false } } },
                {
                    $group: {
                        _id: { value: '$value' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { count: -1 } },
                { $limit: this.app.config.top_alalysis_size.web || 10 },
            ]).exec();
            if (type === 1) this.app.redis.set(`${appId}_top_jump_out_realtime`, JSON.stringify(result));
            return result;
        } catch (err) { console.log(err); }
    }

    // top排行榜 Task任务
    async saveRealTimeTopTask(appId, type, begin, end) {
        try {
            let beginTime = begin;
            let endTime = end;
            if (type === 1) {
                beginTime = this.app.format(new Date(), 'yyyy/MM/dd') + ' 00:00:00';
                endTime = new Date();
            }
            const pages = Promise.resolve(this.getRealTimeTopPagesForDb(appId, beginTime, endTime, type));
            const jump = Promise.resolve(this.getRealTimeTopJumpOutForDb(appId, beginTime, endTime, type));

            if (type === 2) {
                // 每天数据存储到数据库
                const provinces = Promise.resolve(this.getProvinceAvgCountForDb(appId, beginTime, endTime, type));
                const all = await Promise.all([ pages, jump, provinces ]);

                const statis = this.ctx.model.Web.WebStatis();
                statis.app_id = appId;
                statis.top_pages = all[0];
                statis.top_jump_out = all[1];
                statis.provinces = all[2];
                statis.create_time = beginTime;
                const result = await statis.save();

                // 触发日报邮件
                this.ctx.service.web.sendEmail.getDaliyDatas({
                    appId,
                    toppages: all[0],
                    topjumpout: all[1],
                    provinces: all[2],
                }, 'toplist');

                return result;
            }
        } catch (err) { console.log(err); }
    }

    // 省份流量统计
    async getProvinceAvgCount(appId, beginTime, endTime, type) {
        let result = null;
        type = type * 1;
        if (type === 1) {
            result = await this.getProvinceAvgCountForDb(appId, beginTime, endTime, type);
        } else if (type === 2) {
            // 先查询是否存在
            const data = await this.ctx.model.Web.WebStatis.findOne({ app_id: appId, create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) } }).read('sp').exec();
            // 不存在则储存
            result = data ? data : await this.saveRealTimeTopTask(appId, 2, beginTime, endTime);
        }
        return result;
    }

    async getProvinceAvgCountForDb(appId, beginTime, endTime, type) {
        try {
            const result = await this.app.models.WebEnvironment(appId).aggregate([
                { $match: { create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) } } },
                {
                    $group: {
                        _id: { province: '$province' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { count: -1 } },
            ])
                .read('sp')
                .exec();

            return type === 1 ? { provinces: result } : result;
        } catch (err) { console.log(err); }
    }

}

module.exports = AnalysisService;
